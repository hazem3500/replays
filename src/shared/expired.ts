import { isProfileId } from './profiles.ts';

/** How long, by default, a removed replay's record stays listed (`RETENTION_EXPIRED_DAYS`; 0 keeps none). */
export const DEFAULT_EXPIRED_DAYS = 30;

/**
 * What is left of a replay retention removed: enough for the index to show it as expired and say why, and nothing
 * of the recording itself (no events, URL, comments or media). Stored as `_expired/<id>.json` and listed by
 * `GET /api/expired-replays` for `RETENTION_EXPIRED_DAYS` after the removal.
 */
export interface ExpiredReplay {
  id: string;
  title: string;
  host: string;
  /** When it was recorded (the producer's clock). */
  capturedAt: string;
  /** When the retention sweep removed it (the server's clock). */
  expiredAt: string;
  /** The retention window that applied, in whole days. */
  retentionDays: number;
  /** Its profile, when it had one: the profile's window is usually the reason. */
  profile?: string;
  /** The review suite run it was recorded for. */
  suiteRun?: { suiteId: string; runId: string };
}

/** `GET /api/expired-replays`: `records` are the removed replays still on record, newest removal first. */
export interface ExpiredReplays {
  /** How long records are kept after a removal (days); 0 when the deployment keeps none. */
  days: number;
  records: ExpiredReplay[];
}

const isText = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const isIsoDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const read = (value: object, key: string): unknown => Reflect.get(value, key);

function isSuiteRun(value: unknown): value is { suiteId: string; runId: string } {
  return typeof value === 'object' && value !== null && isText(read(value, 'suiteId'), 80) && isText(read(value, 'runId'), 80);
}

export function isExpiredReplay(value: unknown): value is ExpiredReplay {
  if (typeof value !== 'object' || value === null) return false;
  const profile = read(value, 'profile');
  const suiteRun = read(value, 'suiteRun');
  return (
    isText(read(value, 'id'), 80) &&
    isText(read(value, 'title'), 500) &&
    isText(read(value, 'host'), 253) &&
    isIsoDate(read(value, 'capturedAt')) &&
    isIsoDate(read(value, 'expiredAt')) &&
    Number.isInteger(read(value, 'retentionDays')) &&
    (profile === undefined || isProfileId(profile)) &&
    (suiteRun === undefined || isSuiteRun(suiteRun))
  );
}

/** A `GET /api/expired-replays` body, keeping only well-formed records; anything else reads as none kept. */
export function parseExpiredReplays(value: unknown): ExpiredReplays {
  if (typeof value !== 'object' || value === null) return { days: 0, records: [] };
  const days = read(value, 'days');
  const records = read(value, 'records');
  return {
    days: typeof days === 'number' && days > 0 ? days : 0,
    records: Array.isArray(records) ? records.filter(isExpiredReplay) : [],
  };
}
