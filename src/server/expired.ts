import { type ExpiredReplay, isExpiredReplay } from '../shared/expired.ts';
import type { ReplaySummary } from '../shared/replay.ts';
import { type ObjectStorage, readJson } from './storage/index.ts';

const PREFIX = '_expired/';
const DAY_MS = 24 * 60 * 60_000;
/** The most records one listing returns, newest removal first. */
const MAX_LISTED = 500;

/**
 * Records of replays the retention sweep removed (`_expired/<id>.json`, src/shared/expired.ts), kept for `days` after
 * the removal so the index can show them as expired and say why. A record holds only what the index row showed (title,
 * host, dates, profile, suite run) and never the recording. `days` 0 writes none and drops any left from before.
 */
export class ExpiredLedger {
  private readonly storage: ObjectStorage;
  readonly days: number;

  constructor(storage: ObjectStorage, days: number) {
    this.storage = storage;
    this.days = days;
  }

  private key(id: string) {
    return `${PREFIX}${id}.json`;
  }

  /** Notes that retention removed `summary`'s replay at `now` under a `retentionDays` window. */
  async record(summary: ReplaySummary, retentionDays: number, now: number) {
    if (!(this.days > 0)) return;
    const record: ExpiredReplay = {
      id: summary.id,
      title: summary.title,
      host: summary.host,
      capturedAt: summary.capturedAt,
      expiredAt: new Date(now).toISOString(),
      retentionDays,
      ...(summary.profile ? { profile: summary.profile } : {}),
      ...(summary.suiteRun ? { suiteRun: summary.suiteRun } : {}),
    };
    await this.storage.write(this.key(summary.id), `${JSON.stringify(record)}\n`, { contentType: 'application/json; charset=utf-8' });
  }

  /** A replay stored again under the same id is no longer expired. */
  async forget(id: string) {
    await this.storage.delete(this.key(id));
  }

  /** Records still within `days` of their removal, newest removal first. */
  async list(now = Date.now()): Promise<ExpiredReplay[]> {
    if (!(this.days > 0)) return [];
    const objects = await this.storage.list({ prefix: PREFIX, glob: `${PREFIX}*.json` });
    const records = await Promise.all(objects.map((object) => readJson(this.storage, object.key).catch(() => null)));
    return records
      .filter((record): record is ExpiredReplay => isExpiredReplay(record) && Date.parse(record.expiredAt) + this.days * DAY_MS > now)
      .toSorted((a, b) => b.expiredAt.localeCompare(a.expiredAt))
      .slice(0, MAX_LISTED);
  }

  /** Drops records older than `days` (all of them when `days` is 0); returns how many. */
  async prune(now: number) {
    const objects = await this.storage.list({ prefix: PREFIX, glob: `${PREFIX}*.json` });
    let removed = 0;
    for (const object of objects) {
      const record = this.days > 0 ? await readJson(this.storage, object.key).catch(() => null) : undefined;
      const fresh = isExpiredReplay(record) && Date.parse(record.expiredAt) + this.days * DAY_MS > now;
      if (!fresh && (await this.storage.delete(object.key))) removed++;
    }
    return removed;
  }
}
