import { assertReplayContext, type ReplayContext, type SourceAttrs, sourceAttrs } from './context.ts';
import { isPurposeId } from './purposes.ts';
import { assertReplayPeople, minimalPeople, type ReplayPerson, type ReplayPersonSummary } from './people.ts';
import type { KeepRecord } from './retention.ts';

export type ConsoleLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

export interface ReplayConsoleEntry {
  at: number;
  level: ConsoleLevel;
  message: string;
  url?: string;
}

export interface ReplayNetworkEntry {
  id: string;
  at: number;
  duration: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  mimeType?: string;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
}

export interface ReplayStep {
  at: number;
  kind: string;
  label: string;
  selector?: string;
  url?: string;
}

export type ReplayPerformanceKind = 'first-contentful-paint' | 'largest-contentful-paint' | 'long-task' | 'slow-interaction';

export interface ReplayPerformanceEntry {
  at: number;
  kind: ReplayPerformanceKind;
  /** Milliseconds from navigation start for paint metrics, or measured duration for tasks/interactions. */
  value: number;
  /** Event type only (for example `click`); never a selector or DOM text. */
  eventType?: string;
}

export interface ReplayPerformanceTrack {
  /** PerformanceObserver entry types this browser supported during capture. */
  supported: string[];
  entries: ReplayPerformanceEntry[];
}

export type { ReplayContext, ReplaySourceInput, ReplaySourceRef } from './context.ts';
export type { PersonIdentity, ReplayPerson, ReplayPersonSummary } from './people.ts';

/** Who made the recording: the capture CLI (an automated agent or script), or a person via an rrweb import. */
export type ReplaySource = 'agent' | 'human';

export interface ReplayMeta {
  id: string;
  title: string;
  url: string;
  capturedAt: string;
  duration: number;
  viewport: { width: number; height: number };
  eventCount: number;
  version: 1;
  videoFile?: string;
  /** Absent means 'agent'. */
  source?: ReplaySource;
  /** Free-form labels for filtering (`smoke`, `checkout`); lower-case, bounded. */
  tags?: string[];
  /** Why it was recorded: one of the deployment's purposes (src/shared/purposes.ts), checked on upload. Absent: inferred, or none. */
  purpose?: string;
  /** People related to the recording (at most 10; src/shared/people.ts). */
  people?: ReplayPerson[];
}

export const MAX_TAGS = 10;
const TAG = /^[a-z0-9][a-z0-9._:-]{0,39}$/;

export function isReplayTag(value: unknown): value is string {
  return typeof value === 'string' && TAG.test(value);
}

export function assertReplayTags(value: unknown, name = 'replay.meta.tags'): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new Error(`${name} must be an array of at most ${MAX_TAGS} entries`);
  if (!value.every(isReplayTag)) throw new Error(`${name} entries must be 1-40 characters of a-z, 0-9, ".", "_", ":" or "-"`);
}

export interface ReplayBundle {
  meta: ReplayMeta;
  events: Array<Record<string, unknown> & { timestamp: number }>;
  console: ReplayConsoleEntry[];
  network: ReplayNetworkEntry[];
  steps: ReplayStep[];
  /** Optional for backward compatibility and human rrweb imports. */
  performance?: ReplayPerformanceTrack;
  /** Optional, opt-in test-run metadata. */
  context?: ReplayContext;
  /** Optional runner correlation for an explicitly registered review suite run. */
  suiteRun?: { suiteId: string; runId: string };
}

export const MAX_PERFORMANCE_ENTRIES = 500;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PERFORMANCE_TYPES = new Set(['paint', 'largest-contentful-paint', 'longtask', 'event']);
const PERFORMANCE_KINDS = new Set<ReplayPerformanceKind>([
  'first-contentful-paint',
  'largest-contentful-paint',
  'long-task',
  'slow-interaction',
]);

export function assertReplayId(id: string) {
  if (!ID.test(id)) throw new Error('replay id must contain lowercase letters, digits, and dashes');
  return id;
}

export function assertReplayBundle(value: unknown): asserts value is ReplayBundle {
  if (!value || typeof value !== 'object') throw new Error('replay must be an object');
  const replay = value as Partial<ReplayBundle>;
  if (!replay.meta || typeof replay.meta !== 'object') throw new Error('replay.meta is required');
  assertReplayId(String(replay.meta.id ?? ''));
  if (typeof replay.meta.title !== 'string') throw new Error('replay.meta.title must be a string');
  if (!Array.isArray(replay.events) || replay.events.length < 2) {
    throw new Error('replay.events must contain an rrweb recording');
  }
  if (!Array.isArray(replay.steps) || !Array.isArray(replay.console) || !Array.isArray(replay.network)) {
    throw new Error('replay tracks must be arrays');
  }
  if (replay.meta.version !== 1) throw new Error('unsupported replay version');
  if (!Number.isFinite(replay.meta.duration) || Number(replay.meta.duration) < 0) {
    throw new Error('replay duration is invalid');
  }
  if (replay.meta.source !== undefined && replay.meta.source !== 'agent' && replay.meta.source !== 'human') {
    throw new Error("replay.meta.source must be 'agent' or 'human'");
  }
  if (replay.meta.tags !== undefined) assertReplayTags(replay.meta.tags);
  // Only the shape here; the server checks the id against the purposes it defines.
  if (replay.meta.purpose !== undefined && !isPurposeId(replay.meta.purpose))
    throw new Error('replay.meta.purpose must be a purpose id (lower-case letters, digits and "-")');
  if (replay.meta.people !== undefined) assertReplayPeople(replay.meta.people);
  if (replay.context !== undefined) assertReplayContext(replay.context);
  if (replay.suiteRun !== undefined) {
    const suiteRun = replay.suiteRun;
    if (!suiteRun || typeof suiteRun !== 'object') throw new Error('replay.suiteRun is invalid');
    if (Object.keys(suiteRun).some((key) => !['suiteId', 'runId'].includes(key)))
      throw new Error('replay.suiteRun contains unsupported fields');
    assertReplayId(String(suiteRun.suiteId ?? ''));
    if (typeof suiteRun.runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(suiteRun.runId)) {
      throw new Error('replay.suiteRun.runId is invalid');
    }
  }
  if (replay.performance !== undefined) {
    const track = replay.performance;
    if (
      !track ||
      !Array.isArray(track.supported) ||
      !track.supported.every((type) => typeof type === 'string' && PERFORMANCE_TYPES.has(type))
    ) {
      throw new Error('replay.performance.supported is invalid');
    }
    if (!Array.isArray(track.entries) || track.entries.length > MAX_PERFORMANCE_ENTRIES) {
      throw new Error(`replay.performance.entries must contain at most ${MAX_PERFORMANCE_ENTRIES} entries`);
    }
    for (const entry of track.entries) {
      if (
        !entry ||
        !Number.isFinite(entry.at) ||
        entry.at < 0 ||
        !PERFORMANCE_KINDS.has(entry.kind) ||
        !Number.isFinite(entry.value) ||
        entry.value < 0 ||
        (entry.eventType !== undefined &&
          !/^(click|keydown|keyup|input|beforeinput|pointerdown|pointerup|compositionend)$/.test(entry.eventType))
      ) {
        throw new Error('replay.performance.entries contains an invalid entry');
      }
    }
  }
}

/**
 * agent-browser's HAR keeps a redirect hop as its own entry with status 0, no
 * response headers and an empty statusText, and drops the 3xx response itself.
 * A request still in flight when capture stops looks the same. Neither failed.
 */
export function hasNoResponse(entry: Pick<ReplayNetworkEntry, 'status' | 'statusText'>) {
  return entry.status === 0 && !entry.statusText;
}

/** HTTP errors, and network failures, which carry Chrome's `net::ERR_*` text. */
export function isFailedRequest(entry: Pick<ReplayNetworkEntry, 'status' | 'statusText'>) {
  return entry.status >= 400 || (entry.status === 0 && Boolean(entry.statusText));
}

/**
 * The list's compact timeline: enough to draw a mini scrubber without loading the bundle.
 * Times are ms on the replay timeline (0 … duration).
 */
export interface ReplayTimelineSummary {
  /** Step start times, ascending; at most TIMELINE_CAP (evenly thinned beyond that). */
  steps: number[];
  /** Console errors and failed requests, merged when within 0.5 % of the duration; `at` is the earliest member. */
  errors: Array<{ at: number; count: number }>;
}

/** A context source as the list shows it: a link out (pull request, issue, ticket). */
export interface ReplaySourceLink {
  provider: string;
  /** The producer's own label, else the provider's default (`acme/api#12`); empty when there is none. */
  label: string;
  url: string;
  /** The source's attributes from its provider, capped for the list (SUMMARY_SOURCE_ATTRS short values). */
  attrs?: SourceAttrs;
}

/** Bump when ReplaySummary gains derived fields: stored sidecars of an older version are rebuilt lazily. */
export const SUMMARY_VERSION = 7;
export const TIMELINE_CAP = 200;
const MAX_SOURCE_LINKS = 3;
const SUMMARY_SOURCE_ATTRS = 4;
const SUMMARY_ATTR_TEXT = 80;

/** One value a plugin's `summaryFields` derives into the summary (src/server/summary-fields.ts). */
export type SummaryFieldValue = string | number | boolean | null;

/** The small sidecar (`meta.json`) the index lists and filters without loading bundles. */
export interface ReplaySummary {
  id: string;
  title: string;
  url: string;
  host: string;
  capturedAt: string;
  duration: number;
  steps: number;
  consoleErrors: number;
  failedRequests: number;
  source: ReplaySource;
  /** SUMMARY_VERSION the sidecar was built with; absent on version 1 sidecars. */
  summaryVersion?: number;
  /** Recorded viewport, for poster aspect ratios. */
  viewport?: { width: number; height: number };
  timeline?: ReplayTimelineSummary;
  /** `meta.tags`, as given. */
  tags?: string[];
  /** Up to three context sources, in bundle order. */
  sources?: ReplaySourceLink[];
  /** The review suite run the replay was recorded for. */
  suiteRun?: { suiteId: string; runId: string };
  /**
   * Why it was recorded: `meta.purpose`, else what a plugin's `infer` says (the server applies that when it lists,
   * so stored sidecars only ever hold the explicit one). Absent when neither applies.
   */
  purpose?: string;
  /** True when `purpose` was inferred rather than set by the producer. Inferred purposes never make a replay permanent. */
  purposeInferred?: boolean;
  /** Small values derived by plugins at upload (`api.summaryFields`), keyed by plugin name; capped per plugin. */
  ext?: Record<string, Record<string, SummaryFieldValue>>;
  /** Which summary-field sets built `ext` (`plugin/name@version,…`); a sidecar built by another set is rebuilt. */
  extVersion?: string;
  /** `meta.people`; in API responses with the deployment's avatar and profile links. */
  people?: ReplayPersonSummary[];
  /** Pinned by someone with access (never expires); added by the server, never stored in meta.json. */
  kept?: KeepRecord;
  /** When retention removes it; null when it never expires. Added by the server per request. */
  expiresAt?: string | null;
}

export interface ReplayFilters {
  q?: string;
  host?: string;
  errors?: boolean;
  source?: ReplaySource;
  tag?: string;
  purpose?: string;
  /**
   * Plugin index filters, `x-<name>` query parameter → value (`api.indexFilter`). The server's plugin filters match these;
   * `matchesFilters` ignores them.
   */
  params?: Record<string, string>;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function thin(values: number[], cap: number) {
  if (values.length <= cap) return values;
  return Array.from({ length: cap }, (_, index) => values[Math.round((index * (values.length - 1)) / (cap - 1))]!);
}

/** Errors at `times` (ascending) merged into groups no wider than `window` ms, at most `cap` groups. */
export function mergeErrorTimes(times: number[], window: number, cap = TIMELINE_CAP) {
  const groups: Array<{ at: number; count: number }> = [];
  for (const at of times) {
    const last = groups.at(-1);
    if (last && at - last.at <= window) last.count++;
    else groups.push({ at, count: 1 });
  }
  if (groups.length > cap) {
    const rest = groups.splice(cap - 1);
    groups.push({ at: rest[0]!.at, count: rest.reduce((total, group) => total + group.count, 0) });
  }
  return groups;
}

export function summarizeTimeline(bundle: Pick<ReplayBundle, 'meta' | 'steps' | 'console' | 'network'>): ReplayTimelineSummary {
  const duration = Math.max(0, bundle.meta.duration);
  const clamp = (at: number) => Math.round(Math.min(duration, Math.max(0, Number.isFinite(at) ? at : 0)));
  const steps = thin(
    bundle.steps.map((step) => clamp(step.at)).sort((a, b) => a - b),
    TIMELINE_CAP,
  );
  const errorTimes = [
    ...bundle.console.filter((entry) => entry.level === 'error').map((entry) => clamp(entry.at)),
    ...bundle.network.filter(isFailedRequest).map((entry) => clamp(entry.at)),
  ].sort((a, b) => a - b);
  // 0.5 % of the duration: about one dot per pixel at the widest list row, and at most ~200 groups.
  return { steps, errors: mergeErrorTimes(errorTimes, Math.max(1, duration * 0.005)) };
}

export function summarizeReplay(bundle: ReplayBundle): ReplaySummary {
  const { meta } = bundle;
  const consoleErrors = bundle.console.filter((entry) => entry.level === 'error').length;
  const failedRequests = bundle.network.filter(isFailedRequest).length;
  const sources = (bundle.context?.sources ?? []).slice(0, MAX_SOURCE_LINKS).map((source) => {
    const attrs = sourceAttrs(source.attrs, SUMMARY_SOURCE_ATTRS, SUMMARY_ATTR_TEXT);
    return { provider: source.provider, label: source.label ?? source.ref ?? '', url: source.url, ...(attrs ? { attrs } : {}) };
  });
  return {
    id: meta.id,
    title: meta.title,
    url: meta.url,
    host: hostOf(meta.url),
    capturedAt: meta.capturedAt,
    duration: meta.duration,
    steps: bundle.steps.length,
    consoleErrors,
    failedRequests,
    source: meta.source ?? 'agent',
    summaryVersion: SUMMARY_VERSION,
    ...(meta.viewport?.width > 0 && meta.viewport.height > 0
      ? { viewport: { width: meta.viewport.width, height: meta.viewport.height } }
      : {}),
    timeline: summarizeTimeline(bundle),
    ...(meta.tags?.length ? { tags: meta.tags } : {}),
    ...(sources.length ? { sources } : {}),
    ...(bundle.suiteRun ? { suiteRun: { suiteId: bundle.suiteRun.suiteId, runId: bundle.suiteRun.runId } } : {}),
    ...(meta.purpose ? { purpose: meta.purpose, purposeInferred: false } : {}),
    ...(meta.people?.length ? { people: minimalPeople(meta.people) } : {}),
  };
}

export function isReplaySummary(value: unknown): value is ReplaySummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    ['id', 'title', 'url', 'host', 'capturedAt'].every((key) => typeof summary[key] === 'string') &&
    ['duration', 'steps', 'consoleErrors', 'failedRequests'].every((key) => Number.isFinite(summary[key])) &&
    (summary.source === 'agent' || summary.source === 'human')
  );
}

export function matchesFilters(summary: ReplaySummary, filters: ReplayFilters) {
  const query = filters.q?.trim().toLowerCase();
  if (query && ![summary.title, summary.url, summary.id].some((value) => value.toLowerCase().includes(query))) return false;
  if (filters.host && summary.host !== filters.host) return false;
  if (filters.errors && summary.consoleErrors + summary.failedRequests === 0) return false;
  if (filters.source && summary.source !== filters.source) return false;
  if (filters.tag && !summary.tags?.includes(filters.tag)) return false;
  if (filters.purpose && summary.purpose !== filters.purpose) return false;
  return true;
}

export function formatClock(milliseconds: number) {
  // Integer tenths avoid float drift and "0:60.0" when 59.96 s rounds up.
  const tenths = Math.round(Math.max(0, milliseconds) / 100);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`;
}
