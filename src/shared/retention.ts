import type { ReplaySummary } from './replay.ts';

/** Someone with access pinned this replay or suite: it never expires. */
export interface KeepRecord {
  /** The authenticated identity (see auth adapters) that kept it. */
  by: string;
  /** ISO timestamp. */
  at: string;
}

/** What the list, the suite API and `/keep` say about when something goes away. */
export interface Retention {
  kept?: KeepRecord;
  /** ISO timestamp of the prune that removes it; null when it does not expire (kept, or retention is off). */
  expiresAt: string | null;
}

/**
 * A plugin's retention rule (`api.retention({ days })`): whole days to keep this replay, or `0` / `undefined` for
 * "no limit from me". The shortest window any rule (or the purpose, or the default) gives wins; Keep overrides all.
 */
export type RetentionRule = (summary: ReplaySummary) => number | null | undefined;

/** How long uploads are kept. All windows are whole days; 0 means never expire. */
export interface RetentionPolicy {
  /** `RETENTION_DAYS`: the default window (replays without a purpose, review suites). */
  days: number;
  /** Per purpose id (config, plugins, `RETENTION_PURPOSE_<ID>_DAYS`); a purpose without an entry uses `days`. */
  purposes?: Readonly<Record<string, number>>;
  /** `api.retention` rules, already wrapped so they never throw (src/server/purposes.ts). */
  rules?: readonly RetentionRule[];
}

export const DEFAULT_RETENTION: RetentionPolicy = { days: 30 };

const DAY_MS = 24 * 60 * 60_000;

/** What retention needs to know about one replay or suite. */
export interface RetentionInput {
  /**
   * When the server stored it (the storage object's creation time). Age counts from this only, never
   * from the capture time: that comes from the client's clock, which can be wrong.
   */
  uploadedMs: number;
  kept?: unknown;
  /** The replay's purpose (explicit or inferred), when it has one. */
  purpose?: string | undefined;
  /** True when `purpose` was inferred: then it cannot make the replay permanent. */
  purposeInferred?: boolean | undefined;
  /** The replay's summary, for `api.retention` rules (absent for suites and broken uploads: no rules apply). */
  summary?: ReplaySummary | undefined;
}

/**
 * Days `input` is kept under `policy` (0: forever). The purpose's window replaces the default one, except that an
 * inferred purpose whose window is "forever" gets the default instead: only an explicit purpose (or Keep) makes a
 * replay permanent. Rules can only shorten the result: the shortest positive window wins.
 */
export function retentionDays(policy: RetentionPolicy, input: Omit<RetentionInput, 'uploadedMs' | 'kept'> = {}) {
  let days = policy.days;
  const own =
    input.purpose && policy.purposes && Object.hasOwn(policy.purposes, input.purpose) ? policy.purposes[input.purpose] : undefined;
  if (own !== undefined) days = input.purposeInferred && !(own > 0) ? policy.days : own;
  if (!input.summary || !policy.rules?.length) return days;
  let shortest = days > 0 ? days : Number.POSITIVE_INFINITY;
  for (const rule of policy.rules) {
    const value = rule(input.summary);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < shortest) shortest = value;
  }
  return Number.isFinite(shortest) ? shortest : 0;
}

/** When something expires, or undefined when it never does (kept, an explicit purpose kept forever, or retention off). */
export function expiryMs(policy: RetentionPolicy, input: RetentionInput) {
  if (input.kept || !Number.isFinite(input.uploadedMs)) return undefined;
  const days = retentionDays(policy, input);
  if (!(days > 0)) return undefined;
  return input.uploadedMs + days * DAY_MS;
}

export function retentionOf(policy: RetentionPolicy, input: RetentionInput & { kept?: KeepRecord }) {
  const expires = expiryMs(policy, input);
  return {
    ...(input.kept ? { kept: input.kept } : {}),
    expiresAt: expires === undefined ? null : new Date(expires).toISOString(),
  } satisfies Retention;
}

/** A whole number of days from `env[name]` (0 = never), or undefined when unset. Throws on anything else. */
export function daysFromEnv(env: Record<string, string | undefined>, name: string) {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 3650)
    throw new Error(`${name} must be a whole number of days from 0 (never) to 3650`);
  return value;
}

/** The policy from `RETENTION_DAYS` (whole days, 0 = never). Throws on anything else. Per-purpose windows come with the purposes. */
export function retentionFromEnv(env: Record<string, string | undefined>): RetentionPolicy {
  return { days: daysFromEnv(env, 'RETENTION_DAYS') ?? DEFAULT_RETENTION.days };
}
