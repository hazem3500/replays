import type { EditTimeline } from '../../../shared/edits.ts';
import { hasNoResponse, isFailedRequest, type ReplayBundle, type ReplayNetworkEntry, type ReplayStep } from '../../../shared/replay.ts';
import { buildWaterfall, validDuration, type WaterfallRow } from '../waterfall.ts';

export const REQUEST_TYPES = ['document', 'fetch', 'xhr', 'script', 'stylesheet', 'image', 'font', 'other'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const STATUS_CLASSES = ['ok', 'redirect', 'client-error', 'server-error', 'failed', 'pending'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

export type NetworkTiming = Extract<WaterfallRow, { kind: 'network' }>;

/** One request as the table shows it. `at`/`end` are on the player's clock; `entry` keeps the captured values. */
export interface NetworkRow {
  id: string;
  index: number;
  entry: ReplayNetworkEntry;
  timing: NetworkTiming;
  at: number;
  /** Where the bar ends on the player's clock; equals `at` when the duration is unknown. */
  end: number;
  type: RequestType;
  status: StatusClass;
  failed: boolean;
  /** No response was recorded: a redirect hop, or still in flight when capture stopped. */
  unanswered: boolean;
  name: RequestName;
}

export interface RequestName {
  /** Shown only when it differs from the replay's own host. */
  host?: string;
  /** The path up to its last segment ("/api/cart/"), which takes the ellipsis when the column is narrow. */
  head: string;
  /** The last path segment ("apply"), always kept whole. */
  tail: string;
  query: string;
}

const EXTENSIONS: ReadonlyArray<[RegExp, RequestType]> = [
  [/\.(?:html?|php|aspx?)$/, 'document'],
  [/\.(?:m?js|jsx|ts|tsx)$/, 'script'],
  [/\.css$/, 'stylesheet'],
  [/\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/, 'image'],
  [/\.(?:woff2?|ttf|otf|eot)$/, 'font'],
  [/\.json$/, 'fetch'],
];

/** The capture has no initiator, so the type comes from the MIME type, then the URL's extension. */
export function requestType(entry: Pick<ReplayNetworkEntry, 'mimeType' | 'url'>): RequestType {
  const mime = (entry.mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  if (mime) {
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'document';
    if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
    if (mime === 'text/css') return 'stylesheet';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('font/') || mime.includes('font-woff') || mime.includes('opentype')) return 'font';
    if (mime.includes('json') || mime.includes('xml') || mime === 'text/plain' || mime === 'text/event-stream') return 'fetch';
  }
  const path = pathOf(entry.url).toLowerCase();
  return EXTENSIONS.find(([pattern]) => pattern.test(path))?.[1] ?? 'other';
}

export function statusClass(entry: Pick<ReplayNetworkEntry, 'status' | 'statusText'>): StatusClass {
  if (hasNoResponse(entry)) return 'pending';
  if (entry.status === 0) return 'failed';
  if (entry.status >= 500) return 'server-error';
  if (entry.status >= 400) return 'client-error';
  if (entry.status >= 300) return 'redirect';
  return 'ok';
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/** The host of a URL, or undefined when it does not parse. */
export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function requestName(url: string, replayHost: string | undefined): RequestName {
  let host: string | undefined;
  let path = url;
  let query = '';
  try {
    const parsed = new URL(url);
    host = parsed.host === replayHost ? undefined : parsed.host;
    path = parsed.pathname || '/';
    query = parsed.search;
  } catch {
    const [before = url, ...rest] = url.split('?');
    path = before;
    query = rest.length ? `?${rest.join('?')}` : '';
  }
  const cut = path.endsWith('/') && path.length > 1 ? path.lastIndexOf('/', path.length - 2) : path.lastIndexOf('/');
  return { ...(host ? { host } : {}), head: path.slice(0, cut + 1), tail: path.slice(cut + 1), query };
}

/** Requests on the player's clock, in start order; ones that sit wholly inside a cut are left out (`buildWaterfall`). */
export function buildNetworkRows(bundle: ReplayBundle, timeline?: EditTimeline, replayHost = hostOf(bundle.meta.url)): NetworkRow[] {
  return buildWaterfall(bundle, timeline)
    .rows.filter((row): row is NetworkTiming => row.kind === 'network')
    .map((timing, index) => {
      const entry = timing.entry;
      const end = timing.segments.at(-1)?.to ?? timing.at;
      return {
        id: entry.id,
        index,
        entry,
        timing,
        at: timing.at,
        end,
        type: requestType(entry),
        status: statusClass(entry),
        failed: isFailedRequest(entry),
        unanswered: hasNoResponse(entry),
        name: requestName(entry.url, replayHost),
      };
    });
}

/** The step that most recently started at or before `at` (the request's "why"), else the first step after it. */
export function nearestStep(steps: readonly ReplayStep[], at: number) {
  let before: ReplayStep | undefined;
  for (const step of steps) {
    if (step.at <= at) before = step;
    else return before ?? step;
  }
  return before;
}

export function hasMeasuredDuration(row: NetworkRow) {
  return !row.unanswered && row.timing.measured !== undefined && validDuration(row.entry.duration);
}

/** "82 ms", "1.24 s". */
export function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** A shell-safe `curl` line for a captured request (headers only: bodies are not retained). */
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function curlCommand(entry: Pick<ReplayNetworkEntry, 'method' | 'url' | 'requestHeaders'>) {
  const parts = [`curl ${quote(entry.url)}`];
  if (entry.method !== 'GET') parts.push(`-X ${entry.method}`);
  for (const header of entry.requestHeaders) parts.push(`-H ${quote(`${header.name}: ${header.value}`)}`);
  return parts.join(' \\\n  ');
}
