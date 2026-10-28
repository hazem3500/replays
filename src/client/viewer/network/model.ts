import type { EditTimeline } from '../../../shared/edits.ts';
import { hasNoResponse, isFailedRequest, type ReplayBundle, type ReplayNetworkEntry, type ReplayStep } from '../../../shared/replay.ts';
import { buildWaterfall, type WaterfallRow } from '../waterfall.ts';

export const REQUEST_TYPES = ['document', 'fetch', 'script', 'stylesheet', 'image', 'font', 'other'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** A request that took this long or longer is called slow (the old filter's "Slow · 500 ms+"). */
export const SLOW_MS = 500;

/** One request on the player's clock; `entry` keeps the captured values. */
export interface NetworkRow {
  id: string;
  entry: ReplayNetworkEntry;
  /** Where the request starts on the player's clock. */
  at: number;
  /** Where its visible span ends on the player's clock; `at` when the duration is unknown. */
  end: number;
  /** Measured source duration; undefined when the capture has none (no response, or an invalid value). */
  measured: number | undefined;
  type: RequestType;
  failed: boolean;
  /** No response was recorded: a redirect hop, or still in flight when capture stopped. */
  pending: boolean;
  slow: boolean;
  name: RequestName;
}

export interface RequestName {
  /** Set only when it differs from the replay's own host. */
  host?: string;
  path: string;
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

const MIME_TYPES: ReadonlyArray<[(mime: string) => boolean, RequestType]> = [
  [(mime) => mime === 'text/html' || mime === 'application/xhtml+xml', 'document'],
  [(mime) => mime.includes('javascript') || mime.includes('ecmascript'), 'script'],
  [(mime) => mime === 'text/css', 'stylesheet'],
  [(mime) => mime.startsWith('image/'), 'image'],
  [(mime) => mime.startsWith('font/') || mime.includes('font-woff') || mime.includes('opentype'), 'font'],
  [(mime) => mime.includes('json') || mime.includes('xml') || mime === 'text/plain' || mime === 'text/event-stream', 'fetch'],
];

/** The capture has no initiator, so the type comes from the MIME type, then the URL's extension. */
export function requestType(entry: Pick<ReplayNetworkEntry, 'mimeType' | 'url'>): RequestType {
  const mime = (entry.mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const byMime = mime ? MIME_TYPES.find(([test]) => test(mime))?.[1] : undefined;
  if (byMime) return byMime;
  const path = parseUrl(entry.url).path.toLowerCase();
  return EXTENSIONS.find(([pattern]) => pattern.test(path))?.[1] ?? 'other';
}

function parseUrl(url: string): { host?: string; path: string; query: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname || '/', query: parsed.search };
  } catch {
    const [path = url, ...rest] = url.split('?');
    return { path, query: rest.length ? `?${rest.join('?')}` : '' };
  }
}

/** The host of a URL, or undefined when it does not parse. */
export function hostOf(url: string) {
  return parseUrl(url).host;
}

export function requestName(url: string, replayHost: string | undefined): RequestName {
  const { host, path, query } = parseUrl(url);
  return { ...(host && host !== replayHost ? { host } : {}), path, query };
}

/** Requests on the player's clock, in start order; ones wholly inside a cut are left out (`buildWaterfall`). */
export function buildNetworkRows(bundle: ReplayBundle, timeline?: EditTimeline, replayHost = hostOf(bundle.meta.url)): NetworkRow[] {
  return buildWaterfall(bundle, timeline)
    .rows.filter((row): row is Extract<WaterfallRow, { kind: 'network' }> => row.kind === 'network')
    .map((timing) => {
      const entry = timing.entry;
      const pending = hasNoResponse(entry);
      // why: a network error (status 0, net::ERR text) records 0 ms, which is no measurement at all.
      const measured = pending || (entry.status === 0 && !timing.measured) ? undefined : timing.measured;
      return {
        id: entry.id,
        entry,
        at: timing.at,
        end: timing.segments.at(-1)?.to ?? timing.at,
        measured,
        type: requestType(entry),
        failed: isFailedRequest(entry),
        pending,
        slow: !isFailedRequest(entry) && (measured ?? 0) >= SLOW_MS,
        name: requestName(entry.url, replayHost),
      };
    });
}

export type StatusFilter = 'all' | 'failed' | 'slow' | 'pending';

export interface TimeRange {
  from: number;
  to: number;
}

export interface NetworkFilter {
  status: StatusFilter;
  type: RequestType | 'all';
  text: string;
  /** Requests whose span touches this stretch of the player's clock. */
  range?: TimeRange | undefined;
}

export const NO_FILTER: NetworkFilter = { status: 'all', type: 'all', text: '' };

const STATUS_TESTS: Readonly<Record<StatusFilter, (row: NetworkRow) => boolean>> = {
  all: () => true,
  failed: (row) => row.failed,
  slow: (row) => row.slow,
  pending: (row) => row.pending,
};

function matchesText(row: NetworkRow, words: readonly string[]) {
  if (!words.length) return true;
  const text = `${row.entry.method} ${row.entry.url} ${row.entry.status} ${row.entry.statusText}`.toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

export function filterRows(rows: readonly NetworkRow[], filter: NetworkFilter) {
  const words = filter.text.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const range = filter.range;
  return rows.filter(
    (row) =>
      STATUS_TESTS[filter.status](row) &&
      (filter.type === 'all' || row.type === filter.type) &&
      (!range || (row.end >= range.from && row.at <= range.to)) &&
      matchesText(row, words),
  );
}

export function isFiltered(filter: NetworkFilter) {
  return filter.status !== 'all' || filter.type !== 'all' || filter.text.trim() !== '' || filter.range !== undefined;
}

export function statusCounts(rows: readonly NetworkRow[]): Record<StatusFilter, number> {
  return {
    all: rows.length,
    failed: rows.filter(STATUS_TESTS.failed).length,
    slow: rows.filter(STATUS_TESTS.slow).length,
    pending: rows.filter(STATUS_TESTS.pending).length,
  };
}

/** The types this recording has, in menu order, with how many of each. */
export function typeCounts(rows: readonly NetworkRow[]) {
  return REQUEST_TYPES.map((type) => ({ type, count: rows.filter((row) => row.type === type).length })).filter((item) => item.count > 0);
}

/**
 * Where a duration sits on a log scale from 1 ms to `ceiling` (at least 1 s), 0 to 1. A log scale keeps a 6 ms asset
 * and a 2.4 s API call both readable in the same 48 px; each step along the bar is ten times longer.
 */
export function durationShare(ms: number | undefined, ceiling: number) {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return 0;
  const top = Math.log10(1 + Math.max(1000, ceiling));
  return Math.min(1, Math.max(0.04, Math.log10(1 + ms) / top));
}

export function slowestMeasured(rows: readonly NetworkRow[]) {
  return rows.reduce((slowest, row) => Math.max(slowest, row.measured ?? 0), 0);
}

export function medianMeasured(rows: readonly NetworkRow[]) {
  const values = rows.flatMap((row) => (row.measured === undefined ? [] : [row.measured])).toSorted((a, b) => a - b);
  if (!values.length) return undefined;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

/** How many requests start in each of `bins` equal slices of the recording. */
export function startDensity(rows: readonly NetworkRow[], duration: number, bins: number) {
  const counts = Array.from({ length: bins }, () => 0);
  const span = Math.max(1, duration);
  for (const row of rows) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor((row.at / span) * bins)));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  return counts;
}

/**
 * The action a moment belongs to: the latest step that started at or before it, else the first one after it. Waits
 * ("Wait for the page") are skipped when an action exists, since the action is what made the request.
 */
export function stepAt(steps: readonly ReplayStep[], at: number) {
  const actions = steps.filter((step) => step.kind !== 'wait');
  const pool = actions.length ? actions : steps;
  let before: ReplayStep | undefined;
  for (const step of pool) {
    if (step.at > at) return before ?? step;
    before = step;
  }
  return before;
}

/** Margin around a request for its neighbourhood chart, in ms. */
const AROUND_PAD_MS = 150;
const AROUND_MIN_SPAN_MS = 300;

/**
 * The requests in flight around `row`, on a local window: the waterfall is legible here because the window is the
 * request's own scale, not the recording's. The row itself always stays in, whatever `limit` drops.
 */
export function neighbours(row: NetworkRow, rows: readonly NetworkRow[], limit = 10) {
  const from = row.at - AROUND_PAD_MS;
  const to = Math.max(row.end, row.at + AROUND_MIN_SPAN_MS) + AROUND_PAD_MS;
  const near = rows.filter((other) => other.end >= from && other.at <= to);
  const index = near.indexOf(row);
  const start = Math.max(0, Math.min(index - Math.floor(limit / 2), near.length - limit));
  const shown = near.slice(start, start + limit);
  return { from, to, rows: shown, more: near.length - shown.length };
}

function pathKey(entry: Pick<ReplayNetworkEntry, 'method' | 'url'>) {
  const { host, path } = parseUrl(entry.url);
  return `${entry.method} ${host ?? ''}${path}`;
}

/** The same call in another recording: same method, host and path (query aside), the nearest in time. */
export function matchRequest(row: NetworkRow, others: readonly NetworkRow[]) {
  const key = pathKey(row.entry);
  return others
    .filter((other) => pathKey(other.entry) === key)
    .reduce<NetworkRow | undefined>(
      (best, other) => (!best || Math.abs(other.at - row.at) < Math.abs(best.at - row.at) ? other : best),
      undefined,
    );
}

/** At the very end every entry counts as reached (some trail the last DOM event); at 0 none has happened yet. */
export function playheadHorizon(time: number, duration: number) {
  if (time >= duration) return Number.POSITIVE_INFINITY;
  return time <= 0 ? -1 : time;
}

/** The Network tab's badge: the request total, in danger ink when any failed. */
export function networkBadge(rows: readonly NetworkRow[]) {
  const failed = rows.filter((row) => row.failed).length;
  const total = `${rows.length} ${rows.length === 1 ? 'request' : 'requests'}`;
  return {
    value: rows.length,
    ...(failed ? { tone: 'danger' as const } : {}),
    label: failed ? `${total}, ${failed} failed` : total,
  };
}

/** "82 ms", "1.24 s". */
export function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const quote = (value: string) => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** A shell-safe `curl` line for a captured request: headers as retained (already redacted), no body. */
export function curlCommand(entry: Pick<ReplayNetworkEntry, 'method' | 'url' | 'requestHeaders'>) {
  const parts = [`curl ${quote(entry.url)}`];
  if (entry.method !== 'GET') parts.push(`-X ${entry.method}`);
  for (const header of entry.requestHeaders) parts.push(`-H ${quote(`${header.name}: ${header.value}`)}`);
  return parts.join(' \\\n  ');
}
