import { HttpError } from '../../shared/http-error.ts';
import { assertReplayId } from '../../shared/replay.ts';
import { assertReviewSuite, type ReviewSuite } from '../../shared/review-suite.ts';
import { ObjectExistsError, type ObjectInfo, type ObjectStorage, PreconditionFailedError } from '../storage/index.ts';
import { orAbsent } from './async.ts';
import { parseSuiteKey, SUITES_PREFIX, suiteKey } from './keys.ts';
import type { SuiteChange } from './suite-changes.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
const MAX_WRITE_ATTEMPTS = 5;

/** A stored suite and the storage version it was read at. */
export interface StoredSuite {
  suite: ReviewSuite;
  version: string;
}

/** Suite files from one listing: suites, and keep markers by suite id. */
export interface SuiteObjects {
  suites: ObjectInfo[];
  kept: Map<string, ObjectInfo>;
}

/** Sorts suite files into suites and keep markers, ignoring anything else under the prefix. */
export function sortSuiteObjects(objects: readonly ObjectInfo[]): SuiteObjects {
  const suites: ObjectInfo[] = [];
  const kept = new Map<string, ObjectInfo>();
  for (const object of objects) {
    const parsed = parseSuiteKey(object.key);
    if (parsed?.kept) kept.set(parsed.id, object);
    else if (parsed) suites.push(object);
  }
  return { suites, kept };
}

const isWriteRace = (error: unknown): boolean => error instanceof PreconditionFailedError || error instanceof ObjectExistsError;

/** Review suite files (`_suites/<id>.json`): reads, and read-change-write cycles that never lose a concurrent write. */
export class SuiteFiles {
  private readonly storage: ObjectStorage;
  private readonly writes = new Map<string, Promise<void>>();

  constructor(storage: ObjectStorage) {
    this.storage = storage;
  }

  async read(id: string): Promise<StoredSuite | undefined> {
    const key = suiteKey(id);
    const info = await this.storage.stat(key);
    if (!info) return undefined;
    const body = await this.storage.read(key);
    if (!body) return undefined;
    const suite: unknown = JSON.parse(body.toString('utf8'));
    assertReviewSuite(suite);
    return { suite, version: info.version };
  }

  async load(id: string): Promise<ReviewSuite | undefined> {
    assertReplayId(id);
    return (await this.read(id))?.suite;
  }

  async objects(): Promise<SuiteObjects> {
    return sortSuiteObjects(await this.storage.list({ prefix: SUITES_PREFIX, glob: `${SUITES_PREFIX}*.json` }));
  }

  /** Suites, newest write first among at most `limit` (1 to 100), then ordered by creation, newest first. */
  async list(limit: number): Promise<ReviewSuite[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
    const { suites: objects } = await this.objects();
    const ids = objects
      .toSorted((a, b) => b.updatedMs - a.updatedMs)
      .slice(0, boundedLimit)
      .map((object) => object.key.slice(SUITES_PREFIX.length, -'.json'.length));
    const suites = await Promise.all(ids.map((id) => orAbsent(this.load(id))));
    return suites.filter((suite): suite is ReviewSuite => Boolean(suite)).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Replays that belong to a kept suite (they never expire either). */
  async keptReplays(kept?: ReadonlyMap<string, ObjectInfo>): Promise<Set<string>> {
    const ids = new Set<string>();
    const keptSuites = kept ?? (await this.objects()).kept;
    const suites = await Promise.all([...keptSuites.keys()].map((suiteId) => orAbsent(this.load(suiteId))));
    for (const run of suites.flatMap((suite) => suite?.runs ?? [])) if (run.replayId) ids.add(run.replayId);
    return ids;
  }

  /**
   * Read, change, write under the in-process lock, retried when another writer (a second replica) got there first.
   * `change` returns the suite to store, or no `next` to leave it as read.
   */
  update<T>(id: string, change: (current: StoredSuite | undefined) => SuiteChange<T>): Promise<T> {
    return this.locked(id, async () => {
      for (let attempt = 1; ; attempt++) {
        const current = await this.read(id);
        const { next, result } = change(current);
        if (!next) return result;
        assertReviewSuite(next);
        try {
          await this.write(next, current?.version);
          return result;
        } catch (error) {
          if (attempt >= MAX_WRITE_ATTEMPTS || !isWriteRace(error)) throw error;
        }
      }
    });
  }

  /** Changes an existing suite (404 otherwise) and answers the suite as stored. */
  mutate(id: string, mutate: (suite: ReviewSuite) => ReviewSuite): Promise<ReviewSuite> {
    return this.update(id, (current) => {
      if (!current) throw new HttpError(404, `review suite ${id} does not exist`);
      const next = mutate(current.suite);
      return { next, result: next };
    });
  }

  /** invariant: create-only for a new suite, else only over the version read, so a concurrent replica's write is never lost. */
  private async write(suite: ReviewSuite, version: string | undefined): Promise<void> {
    await this.storage.write(suiteKey(suite.id), `${JSON.stringify(suite)}\n`, {
      contentType: JSON_TYPE,
      ...(version === undefined ? { createOnly: true } : { ifVersion: version }),
    });
  }

  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(id) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.writes.set(id, queued);
    await previous;
    try {
      return await work();
    } finally {
      release?.();
      if (this.writes.get(id) === queued) this.writes.delete(id);
    }
  }
}
