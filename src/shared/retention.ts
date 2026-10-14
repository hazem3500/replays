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

/** `RETENTION_DAYS`: whole days to keep an upload; 0 means never expire. */
export interface RetentionPolicy {
  days: number;
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
}

/** When something expires, or undefined when it never does (kept, or retention is off). */
export function expiryMs(policy: RetentionPolicy, input: RetentionInput) {
  if (input.kept || !(policy.days > 0) || !Number.isFinite(input.uploadedMs)) return undefined;
  return input.uploadedMs + policy.days * DAY_MS;
}

export function retentionOf(policy: RetentionPolicy, input: RetentionInput & { kept?: KeepRecord }) {
  const expires = expiryMs(policy, input);
  return {
    ...(input.kept ? { kept: input.kept } : {}),
    expiresAt: expires === undefined ? null : new Date(expires).toISOString(),
  } satisfies Retention;
}

/** The policy from `RETENTION_DAYS` (whole days, 0 = never). Throws on anything else. */
export function retentionFromEnv(env: Record<string, string | undefined>): RetentionPolicy {
  const raw = env.RETENTION_DAYS?.trim();
  if (raw === undefined || raw === '') return { ...DEFAULT_RETENTION };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 3650)
    throw new Error('RETENTION_DAYS must be a whole number of days from 0 (never) to 3650');
  return { days: value };
}
