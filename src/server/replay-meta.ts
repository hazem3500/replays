import { assertReplayId, type ReplaySummary } from '../shared/replay.ts';
import {
  type ReplayMetaOverrides,
  type ReplayMetaPatch,
  replayMetaOverridesSchema,
  type TrashReceipt,
  type TrashRecord,
  trashRecordSchema,
} from '../shared/schemas/replay-meta.ts';
import { ObjectExistsError, type ObjectInfo, type ObjectStorage, readJson } from './storage/index.ts';
import type { ReplayStore } from './store.ts';

/** How long a deleted replay stays restorable before the retention sweep removes it for good. */
export const TRASH_DAYS = 7;

const DAY_MS = 86_400_000;
const JSON_TYPE = 'application/json; charset=utf-8';

/** The sidecar holding what people changed about a replay (the bundle itself never changes). */
export const overridesKey = (id: string) => `${assertReplayId(id)}/overrides.json`;
/** The sidecar that marks a replay as deleted: present means trashed. */
export const trashKey = (id: string) => `${assertReplayId(id)}/trash.json`;

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** When a replay trashed at `at` leaves the trash for good. */
export const restoreBefore = (record: TrashRecord) => new Date(Date.parse(record.at) + TRASH_DAYS * DAY_MS).toISOString();

/** The stored summary with people's changes on top: a title, tags (empty drops them), a purpose (`null` drops it). */
export function applyOverrides(summary: ReplaySummary, overrides: ReplayMetaOverrides | undefined): ReplaySummary {
  if (!overrides) return summary;
  const { tags: recordedTags, purpose: recordedPurpose, purposeInferred: _inferred, ...rest } = summary;
  const tags = overrides.tags ?? recordedTags;
  const purpose = overrides.purpose === undefined ? recordedPurpose : overrides.purpose;
  return { ...rest, title: overrides.title ?? summary.title, ...(tags?.length ? { tags } : {}), ...(purpose ? { purpose } : {}) };
}

interface Cached {
  version: string;
  value: unknown;
}

/**
 * A replay's overrides and trash sidecars, read through a cache keyed by object version (a listing reads only the
 * ones that changed) and written with compare-and-swap, so two concurrent changes never silently drop one.
 */
export class ReplaySidecars {
  readonly #storage: ObjectStorage;
  readonly #changed: () => void;
  readonly #cache = new Map<string, Cached>();

  constructor(storage: ObjectStorage, changed: () => void) {
    this.#storage = storage;
    this.#changed = changed;
  }

  async #read(key: string, info: ObjectInfo | undefined): Promise<unknown> {
    if (!info) return undefined;
    const cached = this.#cache.get(key);
    if (cached?.version === info.version) return cached.value;
    const value = await readJson(this.#storage, key);
    this.#cache.set(key, { version: info.version, value });
    return value;
  }

  /** The overrides in force; `info` is the sidecar's listing entry (undefined: none, so no read). */
  async overrides(id: string, info: ObjectInfo | undefined): Promise<ReplayMetaOverrides | undefined> {
    const parsed = replayMetaOverridesSchema.safeParse(await this.#read(overridesKey(id), info));
    return parsed.success ? parsed.data : undefined;
  }

  async trash(id: string, info: ObjectInfo | undefined): Promise<TrashRecord | undefined> {
    const parsed = trashRecordSchema.safeParse(await this.#read(trashKey(id), info));
    return parsed.success ? parsed.data : undefined;
  }

  stat(key: string) {
    return this.#storage.stat(key);
  }

  /** Merges `patch` into the overrides, as `by` at `now`; a concurrent change in between fails with 409. */
  async update(id: string, patch: ReplayMetaPatch, by: string, now: Date): Promise<ReplayMetaOverrides> {
    const key = overridesKey(id);
    const info = await this.#storage.stat(key);
    const next: ReplayMetaOverrides = { ...(await this.overrides(id, info)), ...patch, by, updatedAt: now.toISOString() };
    await this.#storage.write(key, `${JSON.stringify(next)}\n`, {
      contentType: JSON_TYPE,
      ...(info ? { ifVersion: info.version } : { createOnly: true }),
    });
    this.#changed();
    return next;
  }

  /** Marks the replay deleted (idempotent: a second delete keeps the first record). */
  async markTrashed(id: string, by: string, now: Date): Promise<TrashRecord> {
    const record: TrashRecord = { by, at: now.toISOString() };
    try {
      await this.#storage.write(trashKey(id), `${JSON.stringify(record)}\n`, { createOnly: true, contentType: JSON_TYPE });
    } catch (error) {
      if (!(error instanceof ObjectExistsError)) throw error;
      return (await this.trash(id, await this.#storage.stat(trashKey(id)))) ?? record;
    }
    this.#changed();
    return record;
  }

  /** Takes the replay out of the trash; false when it was not in it. */
  async restore(id: string): Promise<boolean> {
    const removed = await this.#storage.delete(trashKey(id));
    this.#cache.delete(trashKey(id));
    if (removed) this.#changed();
    return removed;
  }
}

/** An uploaded replay that is not trashed, else a 404 (or 409 for a committed sample, which is read-only). */
async function assertChangeable(store: ReplayStore, id: string) {
  const located = await store.locate(id);
  if (!located) throw httpError(404, 'replay not found');
  if (!located.uploaded) throw httpError(409, 'committed samples cannot be changed');
}

/** Applies a validated patch as `by`; answers with the replay's list row as it now shows. */
export async function updateReplayMeta(store: ReplayStore, id: string, patch: ReplayMetaPatch, by: string): Promise<ReplaySummary> {
  await assertChangeable(store, id);
  if (typeof patch.purpose === 'string') {
    const problem = store.purposes.problem(patch.purpose);
    if (problem) throw httpError(400, problem.replace('replay.meta.purpose', 'purpose'));
  }
  await store.sidecars.update(id, patch, by, new Date());
  const summary = await store.summary(id);
  if (!summary) throw httpError(404, 'replay not found');
  return summary;
}

/** Moves a replay to the trash as `by`. A kept replay is refused: release it first, so Keep stays a promise. */
export async function trashReplay(store: ReplayStore, id: string, by: string): Promise<TrashReceipt> {
  await assertChangeable(store, id);
  const summary = await store.summary(id);
  if (summary?.kept) throw httpError(409, 'release Keep on this replay before deleting it');
  const record = await store.sidecars.markTrashed(id, by, new Date());
  return { id, trashedAt: record.at, restoreBefore: restoreBefore(record) };
}

/** Brings a trashed replay back into every list; 404 when it is not in the trash (or the sweep already removed it). */
export async function restoreReplay(store: ReplayStore, id: string): Promise<ReplaySummary> {
  if (!(await store.storage.stat(store.replayKey(id))) || !(await store.sidecars.restore(id)))
    throw httpError(404, 'replay is not in the trash');
  const summary = await store.summary(id);
  if (!summary) throw httpError(404, 'replay not found');
  return summary;
}
