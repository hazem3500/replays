// Pure conversion from a plain rrweb recording to a replay bundle.
// No Node APIs: shared by the `pnpm run import` CLI, the server's
// POST /api/replays/import route, and the browser upload preview.
import { profileOf } from '../shared/profiles.ts';
import { assertReplayBundle, assertReplayId, type ReplayBundle, type ReplayPerson } from '../shared/replay.ts';
import { maskCapturedInputs } from './mask-inputs.ts';
import { sanitizeUrl, sanitizeUrlFields } from './sanitize.ts';

export type RrwebEvent = ReplayBundle['events'][number];

const META = 4;
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const VIEWPORT_RESIZE = 4;
export const FALLBACK_VIEWPORT = { width: 1280, height: 720 };

function randomSuffix() {
  const bytes = new Uint8Array(3);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `<host>-<yyyy-mm-dd-hhmmss>-<random>`, at most 80 characters and always a valid replay id. */
export function defaultId(url: string, now = new Date(), suffix = randomSuffix()) {
  const host = new URL(url).hostname
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
  const timestamp = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
  const safeSuffix =
    suffix
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'capture';
  const tail = `-${timestamp}-${safeSuffix}`;
  const safeHost = host.slice(0, 80 - tail.length).replace(/-$/, '') || 'capture';
  return `${safeHost}${tail}`;
}

/** Accepts a raw event array or an object with an `events` array; returns events sorted by time. */
export function parseRrwebExport(value: unknown): RrwebEvent[] {
  const events = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as { events?: unknown }).events : undefined;
  if (!Array.isArray(events)) throw new Error('expected an array of rrweb events or an object with an "events" array');
  events.forEach((event, index) => {
    if (!event || typeof event !== 'object') throw new Error(`event ${index} is not an object`);
    const { type, timestamp } = event as Record<string, unknown>;
    if (!Number.isInteger(type) || (type as number) < 0 || (type as number) > 6)
      throw new Error(`event ${index} has no valid rrweb "type"`);
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new Error(`event ${index} has no numeric "timestamp"`);
  });
  if (events.length < 2) throw new Error('an rrweb recording needs at least two events');
  if (!events.some((event) => (event as { type: number }).type === FULL_SNAPSHOT))
    throw new Error('the recording has no full snapshot (rrweb event type 2)');
  // why: stable sort: equal timestamps keep their recorded order.
  return (events as RrwebEvent[])
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index)
    .map(({ event }) => event);
}

function dimensions(data: unknown) {
  const { width, height } = (data ?? {}) as { width?: unknown; height?: unknown };
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
}

export interface RecordingInfo {
  /** Sanitized start URL from the Meta event, if there is one. */
  startUrl?: string;
  viewport: { width: number; height: number };
  /** Milliseconds; at least 1. */
  duration: number;
  capturedAt: string;
  eventCount: number;
}

/** Duration, viewport and start URL of sorted rrweb events (see `parseRrwebExport`). */
export function describeRecording(events: RrwebEvent[]): RecordingInfo {
  const meta = events.find((event) => event.type === META);
  const resize = events.find(
    (event) => event.type === INCREMENTAL && (event.data as { source?: unknown } | undefined)?.source === VIEWPORT_RESIZE,
  );
  const href = (meta?.data as { href?: unknown } | undefined)?.href;
  const first = events[0]?.timestamp ?? 0;
  return {
    ...(typeof href === 'string' && href ? { startUrl: sanitizeUrl(href) } : {}),
    viewport: dimensions(meta?.data) ?? dimensions(resize?.data) ?? FALLBACK_VIEWPORT,
    duration: Math.max(1, (events.at(-1)?.timestamp ?? first) - first),
    capturedAt: new Date(first).toISOString(),
    eventCount: events.length,
  };
}

export interface HumanImportOptions {
  title: string;
  url?: string;
  id?: string;
  /** `meta.tags`; validated by assertReplayBundle. */
  tags?: string[];
  /** `meta.profile`; its shape is validated by assertReplayBundle, the id by the server. */
  profile?: string;
  /** @deprecated Use `profile`. */
  purpose?: string;
  /** `meta.people` (`--person`, `?person=`); validated by assertReplayBundle. */
  people?: ReplayPerson[];
}

/**
 * Builds a valid v1 bundle with source 'human' and empty agent/console/network tracks:
 * sorts events, sanitizes every URL field, masks input/textarea/select values.
 */
export function buildHumanBundle(input: unknown, options: HumanImportOptions): ReplayBundle {
  const title = options.title.trim();
  if (!title) throw new Error('--title is required');
  const events = maskCapturedInputs(sanitizeUrlFields(parseRrwebExport(input)));
  const info = describeRecording(events);
  const startUrl = options.url ?? info.startUrl;
  if (!startUrl) throw new Error('the recording has no Meta event (type 4) with an href; pass --url (or the url query parameter)');
  const url = sanitizeUrl(startUrl);
  const id = options.id
    ? assertReplayId(options.id)
    : defaultId(/^https?:/i.test(url) ? url : 'https://recording.invalid/', new Date(info.capturedAt));
  const profile = profileOf(options);
  const bundle: ReplayBundle = {
    meta: {
      id,
      title,
      url,
      capturedAt: info.capturedAt,
      duration: info.duration,
      viewport: info.viewport,
      eventCount: events.length,
      version: 1,
      source: 'human',
      ...(options.tags?.length ? { tags: options.tags } : {}),
      ...(profile ? { profile } : {}),
      ...(options.people?.length ? { people: options.people } : {}),
    },
    events,
    steps: [],
    console: [],
    network: [],
  };
  assertReplayBundle(bundle);
  return bundle;
}
