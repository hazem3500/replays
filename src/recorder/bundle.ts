import { RRWEB_EVENT, type ReplayBundle, type ReplayCaptured, type ReplayRrwebEvent, type ReplayStep } from './bundle-types.ts';
import type { RawConsoleEntry, RawNetworkEntry } from './capture.ts';
import { redactText, redactUrl } from './redact.ts';
import { redactEventUrls } from './sanitize-events.ts';
import { capAtWord } from './step-label.ts';

/** A step before it is placed on the replay timeline (`at` is epoch ms). */
export type RawStep = {
  at: number;
} & Omit<ReplayStep, 'at'>;

export type BuildBundleInput = {
  title: string;
  events: ReplayRrwebEvent[];
  console: RawConsoleEntry[];
  network: RawNetworkEntry[];
  steps: RawStep[];
  /** `meta.captured`; absent leaves the viewer assuming everything but bodies was recorded. */
  captured?: ReplayCaptured;
  /** `meta.profile`: the profile the user chose in the options step. */
  profile?: string;
  now?: Date;
  randomSuffix?: string;
};

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FALLBACK_VIEWPORT = { width: 1280, height: 720 };

function randomSuffix() {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `issue-<yyyy-mm-dd-hhmmss>-<random>`: a valid replay id that, unlike the
 * capture CLI's `<host>-…` ids, does not depend on the page URL.
 */
export function issueReplayId(now: Date, suffix = randomSuffix()): string {
  const stamp = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
  const safe =
    suffix
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'capture';
  return `issue-${stamp}-${safe}`;
}

function viewportOf(events: ReplayRrwebEvent[]) {
  const meta = events.find((event) => event.type === RRWEB_EVENT.Meta);
  const data = meta?.data as { width?: unknown; height?: unknown } | undefined;
  return typeof data?.width === 'number' && typeof data.height === 'number' && data.width > 0 && data.height > 0
    ? { width: Math.round(data.width), height: Math.round(data.height) }
    : FALLBACK_VIEWPORT;
}

function startUrlOf(events: ReplayRrwebEvent[]) {
  const meta = events.find((event) => event.type === RRWEB_EVENT.Meta);
  const href = (meta?.data as { href?: unknown } | undefined)?.href;
  return typeof href === 'string' && href ? href : location.href;
}

/**
 * Builds a version 1 Replays bundle. Every track is placed on the rrweb
 * timeline (ms from the first event), sorted, and URLs are redacted, including
 * the page URLs and URL attributes inside the rrweb events. Throws when the
 * recording has no full snapshot (nothing to replay).
 */
export function buildReplayBundle(input: BuildBundleInput): ReplayBundle {
  const events = input.events.map((event) => redactEventUrls(event)).sort((a, b) => a.timestamp - b.timestamp);
  if (events.length < 2 || !events.some((event) => event.type === RRWEB_EVENT.FullSnapshot)) {
    throw new Error('The recording is empty: no rrweb full snapshot was taken');
  }
  const origin = events[0]!.timestamp;
  const last = events[events.length - 1]!.timestamp;
  const relative = (at: number) => Math.max(0, Math.round(at - origin));
  const id = issueReplayId(input.now ?? new Date(origin), input.randomSuffix);
  if (!ID.test(id)) throw new Error(`Invalid replay id: ${id}`);

  return {
    meta: {
      id,
      title: redactText(input.title, 200),
      url: redactUrl(startUrlOf(events)),
      capturedAt: new Date(origin).toISOString(),
      duration: Math.max(1, last - origin),
      viewport: viewportOf(events),
      eventCount: events.length,
      version: 1,
      source: 'human',
      ...(input.captured ? { captured: { ...input.captured } } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
    },
    events,
    console: input.console.map((entry) => ({ ...entry, at: relative(entry.at) })).sort((a, b) => a.at - b.at),
    network: input.network
      .map((entry, index) => ({
        id: `request-${index + 1}`,
        ...entry,
        at: relative(entry.at),
      }))
      .sort((a, b) => a.at - b.at),
    steps: input.steps
      .map((step) => ({
        ...step,
        label: capAtWord(redactText(step.label, Number.MAX_SAFE_INTEGER), 200),
        ...(step.url ? { url: redactUrl(step.url) } : {}),
        at: relative(step.at),
      }))
      .sort((a, b) => a.at - b.at),
  };
}
