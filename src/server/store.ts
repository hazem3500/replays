import {
  assertReplayBundle,
  assertReplayId,
  isReplaySummary,
  matchesFilters,
  type ReplayBundle,
  type ReplayFilters,
  type ReplaySummary,
  SUMMARY_VERSION,
  summarizeReplay,
} from '../shared/replay.ts';
import {
  assertReplayEdits,
  assertStoredReplayEdits,
  bundleSpan,
  EMPTY_EDITS,
  normalizeEdits,
  sameEdits,
  type StoredReplayEdits,
} from '../shared/edits.ts';
import { DEFAULT_RETENTION, expiryMs, type KeepRecord, type Retention, type RetentionPolicy, retentionOf } from '../shared/retention.ts';
import {
  assertReviewRunRegistration,
  assertReviewSuite,
  type ReviewRunRegistration,
  type ReviewSuite,
  type ResolvedSuiteRegistration,
  type ReviewSuiteIndexEntry,
  type ReviewSuiteRun,
  type ReviewSuiteSummary,
  summarizeReviewSuite,
} from '../shared/review-suite.ts';
import { FsStorage, ObjectExistsError, type ObjectInfo, type ObjectStorage, PreconditionFailedError, readJson } from './storage/index.ts';
import { captureLink, withSpan } from './tracing.ts';

export type { ReplaySummary } from '../shared/replay.ts';

/** Bump when the poster moment or format changes (the client's poster URL carries it too). */
export const POSTER_VERSION = 2;
/** Bump when the opening still's moment or format changes (the client's URL carries it too). */
export const OPEN_STILL_VERSION = 1;
/** Bump when the preview's speed, cap or encoding changes. */
export const PREVIEW_VERSION = 2;

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const JSON_TYPE = 'application/json; charset=utf-8';
/** Upload-triggered prunes run at most this often (the periodic one runs every six hours regardless). */
const PRUNE_THROTTLE_MS = 10 * 60_000;

export class ReplayConflictError extends Error {
  readonly status = 409;

  constructor(id: string) {
    super(`replay ${id} already exists`);
  }
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** At most `size` holders at a time. */
function limiter(size: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async acquire() {
      if (active < size) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    release() {
      const next = waiting.shift();
      if (next) next();
      else active--;
    },
  };
}

/** Where an id's bundle lives: an upload in the store, or a committed sample shipped with the code. */
export interface LocatedReplay {
  storage: ObjectStorage;
  key: string;
  info: ObjectInfo;
  /** Uploads are immutable (save() refuses an existing id); samples can change with a deploy. */
  uploaded: boolean;
}

/** A whole number of days (tests, scripts) or a policy object. */
function policyFrom(retention: number | Partial<RetentionPolicy> | undefined): RetentionPolicy {
  if (typeof retention === 'number') return { days: retention };
  return { ...DEFAULT_RETENTION, ...retention };
}

function parseKeep(value: unknown): KeepRecord | undefined {
  const record = value as Partial<KeepRecord> | undefined;
  return record && typeof record.by === 'string' && typeof record.at === 'string' ? { by: record.by, at: record.at } : undefined;
}

/**
 * Replays, their sidecars and media, and review suites, on an ObjectStorage (src/server/storage/): the
 * local DATA_DIR (`STORAGE=fs`) or an S3-compatible bucket (`STORAGE=s3`). Layout, identical on both:
 *
 *   <id>/replay.json               the bundle (immutable)
 *   <id>/meta.json                 its list summary (rebuilt when missing, stale or an older SUMMARY_VERSION)
 *   <id>/keep.json                 `{ by, at }` while someone keeps it (no expiry)
 *   <id>/edits.json                its edit list (src/shared/edits.ts): trims and cuts applied on playback and export
 *   <id>/poster.v2.jpg, open.v1.jpg, preview.v2.mp4(.json), session.mp4, rendered-*.mp4, render-*.json
 *   _suites/<id>.json              a review suite
 *   _suites/<id>.keep.json         kept suite
 *
 * Committed samples (`sample/<id>.json`) are part of the code, read-only, and never expire.
 */
export class ReplayStore {
  readonly storage: ObjectStorage;
  readonly samples: FsStorage;
  readonly sampleDir: string;
  readonly retention: RetentionPolicy;
  /** Parsed summaries keyed by id, valid while the sidecar's version (generation / mtime) is unchanged. */
  private readonly summaryCache = new Map<string, { version: string; summary: ReplaySummary | undefined }>();
  private readonly keepCache = new Map<string, { version: string; keep: KeepRecord | undefined }>();
  /** Replay spans (ms) keyed by id, valid while the bundle's version is unchanged: an edit save checks its times against it. */
  private readonly spanCache = new Map<string, { version: string; span: number }>();
  private readonly suiteWrites = new Map<string, Promise<void>>();
  private lastPrune = 0;
  private pruning: Promise<string[]> | undefined;
  /**
   * The unfiltered list, reused for `listTtlMs` (the backend's `listCacheMs` unless given): with S3 a list is a few
   * API pages, so the index's bursts (filters, Back) share one. This process's own writes clear it; another replica's
   * show up within the TTL. 0 (fs, memory) lists every time.
   */
  private listed: { at: number; summaries: Promise<ReplaySummary[]> } | undefined;
  readonly listTtlMs: number;

  constructor(
    data: string | ObjectStorage,
    sampleDir: string,
    retention?: number | Partial<RetentionPolicy>,
    options: { listTtlMs?: number } = {},
  ) {
    this.storage = typeof data === 'string' ? new FsStorage(data) : data;
    this.sampleDir = sampleDir;
    this.samples = new FsStorage(sampleDir);
    this.retention = policyFrom(retention);
    this.listTtlMs = options.listTtlMs ?? Math.max(0, Number(this.storage.listCacheMs) || 0);
  }

  /** DATA_DIR with the fs driver; tests and scripts only. */
  get dataDir() {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no data directory with STORAGE=${this.storage.kind}`);
    return this.storage.root;
  }

  replayKey(id: string) {
    return `${assertReplayId(id)}/replay.json`;
  }

  metaKey(id: string) {
    return `${assertReplayId(id)}/meta.json`;
  }

  keepKey(id: string) {
    return `${assertReplayId(id)}/keep.json`;
  }

  editsKey(id: string) {
    return `${assertReplayId(id)}/edits.json`;
  }

  suiteKey(id: string) {
    return `_suites/${assertReplayId(id)}.json`;
  }

  suiteKeepKey(id: string) {
    return `_suites/${assertReplayId(id)}.keep.json`;
  }

  /**
   * The list thumbnail (src/server/posters.ts); under the replay's prefix so retention prunes it with
   * the replay. Versioned: when the poster moment changes, older posters are simply not found and remade.
   */
  posterKey(id: string) {
    return `${assertReplayId(id)}/poster.v${POSTER_VERSION}.jpg`;
  }

  /**
   * The opening still (src/server/posters.ts): the replay as the viewer first paints it (t = 0), at the
   * poster's size, so the page transition lands on exactly what rrweb draws. Next to the poster.
   */
  openStillKey(id: string) {
    return `${assertReplayId(id)}/open.v${OPEN_STILL_VERSION}.jpg`;
  }

  /** The hover preview clip (src/server/posters.ts), next to the poster. */
  previewKey(id: string) {
    return `${assertReplayId(id)}/preview.v${PREVIEW_VERSION}.mp4`;
  }

  videoKey(id: string) {
    return `${assertReplayId(id)}/session.mp4`;
  }

  /** The files behind the keys above, with the fs driver only (tests). */
  posterFile(id: string) {
    return this.fsPath(this.posterKey(id));
  }

  openStillFile(id: string) {
    return this.fsPath(this.openStillKey(id));
  }

  previewFile(id: string) {
    return this.fsPath(this.previewKey(id));
  }

  videoFile(id: string) {
    return this.fsPath(this.videoKey(id));
  }

  private fsPath(key: string) {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no local files with STORAGE=${this.storage.kind}`);
    return this.storage.path(key);
  }

  private sampleKey(id: string) {
    return `${assertReplayId(id)}.json`;
  }

  // Suites

  private async readSuite(id: string): Promise<{ suite: ReviewSuite; version: string } | undefined> {
    const key = this.suiteKey(id);
    const info = await this.storage.stat(key);
    if (!info) return undefined;
    const body = await this.storage.read(key);
    if (!body) return undefined;
    const suite: unknown = JSON.parse(body.toString('utf8'));
    assertReviewSuite(suite);
    return { suite, version: info.version };
  }

  /** Create-only for a new suite, else only over the version read: a concurrent replica's write is never lost. */
  private async writeSuite(suite: ReviewSuite, version: string | undefined) {
    await this.storage.write(this.suiteKey(suite.id), `${JSON.stringify(suite)}\n`, {
      contentType: JSON_TYPE,
      ...(version === undefined ? { createOnly: true } : { ifVersion: version }),
    });
  }

  private async withSuiteLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.suiteWrites.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const queued = previous.then(() => current);
    this.suiteWrites.set(id, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.suiteWrites.get(id) === queued) this.suiteWrites.delete(id);
    }
  }

  /**
   * Read, change, write under the in-process lock, retried when another writer (a second replica) got
   * there first. `change` returns the suite to store, or undefined to leave it as read.
   */
  private async updateSuite<T extends ReviewSuite | undefined>(
    id: string,
    change: (current: { suite: ReviewSuite; version: string } | undefined) => { next: ReviewSuite | undefined; result: T },
  ): Promise<T> {
    return this.withSuiteLock(id, async () => {
      for (let attempt = 0; ; attempt++) {
        const current = await this.readSuite(id);
        const { next, result } = change(current);
        if (!next) return result;
        assertReviewSuite(next);
        try {
          await this.writeSuite(next, current?.version);
          return result;
        } catch (error) {
          if (attempt >= 4 || !(error instanceof PreconditionFailedError || error instanceof ObjectExistsError)) throw error;
        }
      }
    });
  }

  private async mutateSuite(id: string, mutate: (suite: ReviewSuite) => ReviewSuite | void) {
    return this.updateSuite(id, (current) => {
      if (!current) throw httpError(404, `review suite ${id} does not exist`);
      const next = mutate(current.suite) ?? current.suite;
      return { next, result: next };
    });
  }

  async loadSuite(id: string): Promise<ReviewSuite | undefined> {
    assertReplayId(id);
    return (await this.readSuite(id))?.suite;
  }

  /** Suite ids (newest write first) and which of them are kept, from one listing. */
  private async suiteObjects() {
    const objects = await this.storage.list({ prefix: '_suites/', glob: '_suites/*.json' });
    const suites: ObjectInfo[] = [];
    const kept = new Map<string, ObjectInfo>();
    for (const object of objects) {
      const name = object.key.slice('_suites/'.length);
      const keep = /^([a-z0-9][a-z0-9-]{0,79})\.keep\.json$/.exec(name);
      if (keep) kept.set(keep[1]!, object);
      else if (/^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name)) suites.push(object);
    }
    return { suites, kept };
  }

  async listSuites(limit = 100): Promise<ReviewSuite[]> {
    const boundedLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
    const { suites: objects } = await this.suiteObjects();
    const ids = objects
      .sort((a, b) => b.updatedMs - a.updatedMs)
      .slice(0, boundedLimit)
      .map((object) => object.key.slice('_suites/'.length, -'.json'.length));
    const suites = await Promise.all(ids.map((id) => this.loadSuite(id).catch(() => undefined)));
    return suites.filter((suite): suite is ReviewSuite => Boolean(suite)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listSuiteSummaries(limit = 20): Promise<ReviewSuiteSummary[]> {
    const suites = await this.listSuites(limit);
    return Promise.all(suites.map(async (suite) => ({ ...summarizeReviewSuite(suite), ...(await this.suiteRetentionOf(suite)) })));
  }

  /** Suite summaries with their runs and each run's replay summary, for the grouped index. */
  async listSuiteIndex(limit = 100): Promise<ReviewSuiteIndexEntry[]> {
    // Runs' replays come from the memoized list (one lookup each), not three stats per run; the suites' own
    // retention stats go a few dozen at a time.
    const [suites, summaries] = await Promise.all([this.listSuites(limit), this.list()]);
    const listed = new Map(summaries.map((summary) => [summary.id, summary]));
    const gate = limiter(32);
    return Promise.all(
      suites.map(async (suite) => {
        await gate.acquire();
        try {
          return await this.suiteIndexEntry(suite, listed);
        } finally {
          gate.release();
        }
      }),
    );
  }

  /**
   * One suite as the index (and the suite workspace) lists it: summary plus runs with replay summaries. With
   * `listed` (the index), a run's replay is looked up there, and read on its own only when the list (memoized
   * for a few seconds) does not have it yet.
   */
  async suiteIndexEntry(suite: ReviewSuite, listed?: ReadonlyMap<string, ReplaySummary>): Promise<ReviewSuiteIndexEntry> {
    const retention = await this.suiteRetentionOf(suite);
    return {
      ...summarizeReviewSuite(suite),
      ...retention,
      runDetails: await Promise.all(
        suite.runs
          .toSorted((a, b) => a.sequence - b.sequence)
          .map(async ({ id, sequence, label, status, startedAt, finishedAt, replayId }) => {
            const found = replayId
              ? (listed?.get(replayId) ?? (await this.summary(replayId, { suites: false }).catch(() => undefined)))
              : undefined;
            // A kept suite keeps its runs' replays.
            const replay = found && retention.kept ? { ...found, expiresAt: null } : found;
            return {
              id,
              sequence,
              label,
              status,
              startedAt,
              ...(finishedAt ? { finishedAt } : {}),
              ...(replayId ? { replayId } : {}),
              ...(replay ? { replay } : {}),
            };
          }),
      ),
    };
  }

  async registerSuite(id: string, input: ResolvedSuiteRegistration) {
    return this.updateSuite(id, (current) => {
      if (!current) {
        const suite: ReviewSuite = { ...input, id, runs: [] };
        return { next: suite, result: suite };
      }
      const existing = current.suite;
      // Registering again is idempotent: the same registration changes nothing, a different one conflicts.
      const { runs: _runs, ...currentIdentity } = existing;
      if (JSON.stringify(currentIdentity) !== JSON.stringify({ ...input, id })) {
        throw httpError(409, `suite ${id} conflicts with its existing registration`);
      }
      return { next: undefined, result: existing };
    });
  }

  async registerRun(suiteId: string, runId: string, input: ReviewRunRegistration) {
    assertReviewRunRegistration(input, runId);
    return this.mutateSuite(suiteId, (suite) => {
      const existing = suite.runs.find((run) => run.id === runId);
      if (existing && existing.sequence !== input.sequence) {
        throw httpError(409, `run ${runId} sequence cannot change`);
      }
      if (existing && (existing.label !== input.label || existing.startedAt !== input.startedAt)) {
        throw httpError(409, `run ${runId} identity cannot change`);
      }
      if (existing && existing.status !== 'running' && existing.status !== input.status) {
        throw httpError(409, `run ${runId} terminal status cannot change`);
      }
      if (existing?.replayId && input.status === 'running') return suite;
      const run: ReviewSuiteRun = {
        ...input,
        ...(existing?.replayId ? { replayId: existing.replayId, recording: existing.recording } : {}),
      };
      return {
        ...suite,
        runs: existing ? suite.runs.map((item) => (item.id === runId ? run : item)) : [...suite.runs, run],
      };
    });
  }

  async assertSuiteRunCanAttach(suiteId: string, runId: string, replayId: string) {
    const suite = await this.loadSuite(suiteId);
    const run = suite?.runs.find((item) => item.id === runId);
    if (!suite || !run) throw httpError(404, 'review suite run is not registered');
    if (run.replayId && run.replayId !== replayId) throw httpError(409, 'review suite run already has a different recording');
    return { suite, run };
  }

  async attachReplay(suiteId: string, runId: string, bundle: ReplayBundle) {
    return this.mutateSuite(suiteId, (suite) => {
      const run = suite.runs.find((item) => item.id === runId);
      if (!run) throw httpError(404, 'review suite run is not registered');
      if (run.replayId && run.replayId !== bundle.meta.id) {
        throw httpError(409, 'review suite run already has a different recording');
      }
      return {
        ...suite,
        runs: suite.runs.map((item) =>
          item.id === runId
            ? {
                ...item,
                replayId: bundle.meta.id,
                recording: {
                  title: bundle.meta.title,
                  duration: bundle.meta.duration,
                  steps: bundle.steps.length,
                  viewport: bundle.meta.viewport,
                },
              }
            : item,
        ),
      };
    });
  }

  // Replays

  async load(id: string): Promise<ReplayBundle | undefined> {
    assertReplayId(id);
    for (const [storage, key] of [
      [this.storage, this.replayKey(id)],
      [this.samples, this.sampleKey(id)],
    ] as const) {
      const source = await storage.read(key);
      if (!source) continue;
      const bundle: unknown = JSON.parse(source.toString('utf8'));
      assertReplayBundle(bundle);
      return bundle;
    }
    return undefined;
  }

  /**
   * Where a replay's JSON lives (upload first, then committed sample), without reading it. `uploaded`
   * bundles are immutable: save() refuses an existing id (409), so a stored id never changes content.
   */
  async locate(id: string): Promise<LocatedReplay | undefined> {
    assertReplayId(id);
    const uploaded = await this.storage.stat(this.replayKey(id));
    if (uploaded) return { storage: this.storage, key: this.replayKey(id), info: uploaded, uploaded: true };
    const sample = await this.samples.stat(this.sampleKey(id));
    if (sample) return { storage: this.samples, key: this.sampleKey(id), info: sample, uploaded: false };
    return undefined;
  }

  async save(bundle: ReplayBundle) {
    assertReplayBundle(bundle);
    const id = bundle.meta.id;
    if (await this.samples.stat(this.sampleKey(id))) throw new ReplayConflictError(id);
    try {
      await this.storage.write(this.replayKey(id), `${JSON.stringify(bundle)}\n`, { createOnly: true, contentType: JSON_TYPE });
    } catch (error) {
      if (error instanceof ObjectExistsError) throw new ReplayConflictError(id);
      throw error;
    }
    await this.writeSummary(id, summarizeReplay(bundle)).catch((error: unknown) => console.error('meta.json write failed:', error));
    this.changed();
    return this.replayKey(id);
  }

  async saveVideo(id: string, body: Buffer) {
    assertReplayId(id);
    if (await this.samples.stat(this.sampleKey(id))) throw new ReplayConflictError(id);
    if (!(await this.storage.stat(this.replayKey(id)))) throw httpError(404, `replay ${id} does not exist`);
    try {
      await this.storage.write(this.videoKey(id), body, { createOnly: true, contentType: 'video/mp4' });
    } catch (error) {
      if (error instanceof ObjectExistsError) throw new ReplayConflictError(id);
      throw error;
    }
    return this.videoKey(id);
  }

  private async writeSummary(id: string, summary: ReplaySummary) {
    await this.storage.write(this.metaKey(id), `${JSON.stringify(summary)}\n`, { contentType: JSON_TYPE });
  }

  /**
   * An upload's summary from its `meta.json` sidecar, which is built lazily (and rebuilt when older than
   * `replay.json` or built by an older SUMMARY_VERSION, e.g. before the list gained timelines). Parsed
   * sidecars are cached by the object's version, so listing ~2000 replays reads only what changed.
   */
  private async uploadedSummary(id: string, replay: ObjectInfo, meta: ObjectInfo | undefined): Promise<ReplaySummary | undefined> {
    if (meta && meta.updatedMs >= replay.updatedMs) {
      const cached = this.summaryCache.get(id);
      if (cached?.summary && cached.version === meta.version) return cached.summary;
      const parsed = await readJson(this.storage, this.metaKey(id)).catch(() => undefined);
      if (isReplaySummary(parsed) && parsed.id === id && parsed.summaryVersion === SUMMARY_VERSION) {
        this.summaryCache.set(id, { version: meta.version, summary: parsed });
        return parsed;
      }
    }
    const bundle = await this.load(id);
    if (!bundle) return undefined;
    const summary = summarizeReplay(bundle);
    await this.writeSummary(id, summary).catch((error: unknown) => console.error('meta.json backfill failed:', error));
    return summary;
  }

  /** Committed samples are read-only: their summaries are cached in memory by the file's version. */
  private async sampleSummary(id: string, sample: ObjectInfo) {
    const cacheKey = `sample:${id}`;
    const cached = this.summaryCache.get(cacheKey);
    if (cached?.version === sample.version) return cached.summary;
    const summary = await this.load(id)
      .then((bundle) => (bundle ? summarizeReplay(bundle) : undefined))
      .catch(() => undefined);
    this.summaryCache.set(cacheKey, { version: sample.version, summary });
    return summary;
  }

  private async keepOf(key: string, info: ObjectInfo | undefined) {
    if (!info) return undefined;
    const cached = this.keepCache.get(key);
    if (cached?.version === info.version) return cached.keep;
    const keep = parseKeep(await readJson(this.storage, key).catch(() => undefined));
    this.keepCache.set(key, { version: info.version, keep });
    return keep;
  }

  private retentionFor(summary: ReplaySummary, replay: ObjectInfo, keep: KeepRecord | undefined, keptBySuite: boolean): Retention {
    if (keptBySuite && !keep) return { expiresAt: null };
    return retentionOf(this.retention, {
      uploadedMs: replay.createdMs,
      ...(keep ? { kept: keep } : {}),
    });
  }

  /** Replays that belong to a kept suite (they never expire either). */
  private async keptSuiteReplays(kept?: Map<string, ObjectInfo>) {
    const ids = new Set<string>();
    const keptSuites = kept ?? (await this.suiteObjects()).kept;
    await Promise.all(
      [...keptSuites.keys()].map(async (suiteId) => {
        const suite = await this.loadSuite(suiteId).catch(() => undefined);
        for (const run of suite?.runs ?? []) if (run.replayId) ids.add(run.replayId);
      }),
    );
    return ids;
  }

  /**
   * The replay's summary, with `kept` and `expiresAt`. `suites: false` skips looking for a kept suite
   * holding it (the suite index knows its own suite's state).
   */
  async summary(id: string, { suites = true }: { suites?: boolean } = {}): Promise<ReplaySummary | undefined> {
    assertReplayId(id);
    const [replay, meta, keepInfo] = await Promise.all([
      this.storage.stat(this.replayKey(id)),
      this.storage.stat(this.metaKey(id)),
      this.storage.stat(this.keepKey(id)),
    ]);
    if (replay) {
      const summary = await this.uploadedSummary(id, replay, meta);
      if (!summary) return undefined;
      const keep = await this.keepOf(this.keepKey(id), keepInfo);
      const keptBySuite = suites && !keep && (await this.keptSuiteReplays()).has(id);
      return { ...summary, ...this.retentionFor(summary, replay, keep, keptBySuite) };
    }
    const sample = await this.samples.stat(this.sampleKey(id));
    if (!sample) return undefined;
    const summary = await this.sampleSummary(id, sample);
    return summary ? { ...summary, expiresAt: null } : undefined;
  }

  async list(filters: ReplayFilters = {}): Promise<ReplaySummary[]> {
    const now = Date.now();
    if (!this.listed || this.listTtlMs <= 0 || now - this.listed.at >= this.listTtlMs) {
      const pending = this.listAll();
      this.listed = { at: now, summaries: pending };
      pending.catch(() => {
        if (this.listed?.summaries === pending) this.listed = undefined;
      });
    }
    const summaries = await this.listed.summaries;
    return summaries.filter((summary) => matchesFilters(summary, filters));
  }

  /** Forgets the memoized list after this process changes what it shows. */
  private changed() {
    this.listed = undefined;
  }

  private async listAll(): Promise<ReplaySummary[]> {
    // One listing of just the small JSON objects (GCS matchGlob): ~4 pages for 2000 replays, no media.
    const [objects, samples, suites] = await Promise.all([
      this.storage.list({ glob: '*/{replay,meta,keep}.json' }),
      this.samples.list({ glob: '*.json' }),
      this.suiteObjects(),
    ]);
    const keptBySuite = suites.kept.size ? await this.keptSuiteReplays(suites.kept) : new Set<string>();
    const uploads = new Map<string, { replay?: ObjectInfo; meta?: ObjectInfo; keep?: ObjectInfo }>();
    for (const object of objects) {
      const [id, name] = object.key.split('/') as [string, string];
      if (!ID.test(id)) continue;
      const entry = uploads.get(id) ?? {};
      entry[name.slice(0, -'.json'.length) as 'replay' | 'meta' | 'keep'] = object;
      uploads.set(id, entry);
    }
    // Sidecar reads (only the changed ones once warm) go a few dozen at a time, not 2000 sockets at once.
    const gate = limiter(32);
    const summaries = await Promise.all([
      ...[...uploads].map(async ([id, { replay, meta, keep: keepInfo }]) => {
        if (!replay) return undefined;
        await gate.acquire();
        try {
          const summary = await this.uploadedSummary(id, replay, meta).catch(() => undefined);
          if (!summary) return undefined;
          const keep = await this.keepOf(this.keepKey(id), keepInfo);
          return { ...summary, ...this.retentionFor(summary, replay, keep, keptBySuite.has(id)) };
        } finally {
          gate.release();
        }
      }),
      ...samples.map(async (sample) => {
        const id = sample.key.slice(0, -'.json'.length);
        if (!ID.test(id) || uploads.get(id)?.replay) return undefined;
        const summary = await this.sampleSummary(id, sample);
        return summary ? { ...summary, expiresAt: null } : undefined;
      }),
    ]);
    return summaries
      .filter((summary): summary is ReplaySummary => isReplaySummary(summary))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  // Edits (non-destructive: the bundle never changes)

  /**
   * The replay's span on the player's clock (the rrweb track's length), which every edit time is measured on;
   * undefined when there is no such replay. Cached per bundle version: a save does not reparse the bundle.
   */
  async replaySpan(id: string): Promise<number | undefined> {
    const located = await this.locate(id);
    if (!located) return undefined;
    const cacheKey = `${located.uploaded ? 'upload' : 'sample'}:${id}`;
    const cached = this.spanCache.get(cacheKey);
    if (cached?.version === located.info.version) return cached.span;
    const bundle = await this.load(id);
    if (!bundle) return undefined;
    const span = bundleSpan(bundle);
    this.spanCache.set(cacheKey, { version: located.info.version, span });
    return span;
  }

  /**
   * The stored edit list and its storage version (undefined when none was ever saved). A sidecar that does not
   * validate reads as no edits, with its version, so the next save can replace it.
   */
  async readEdits(id: string): Promise<{ edits: StoredReplayEdits; version: string | undefined }> {
    const key = this.editsKey(id);
    const info = await this.storage.stat(key);
    const none = { ...EMPTY_EDITS, revision: 0 };
    if (!info) return { edits: none, version: undefined };
    const parsed = await readJson(this.storage, key).catch(() => undefined);
    try {
      assertStoredReplayEdits(parsed);
      return { edits: parsed, version: info.version };
    } catch (error) {
      console.error(`edits ${id}: unreadable sidecar ignored:`, error instanceof Error ? error.message : error);
      return { edits: none, version: info.version };
    }
  }

  /**
   * Saves an edit list for `id`, recording who and when. Writes are generation-checked: `ifVersion` is the storage
   * version the editor loaded (null: it saw none), and a save over anything else is a 409 that carries the current
   * list. Saving the list already stored is a no-op (an idempotent retry), whatever `ifVersion` says.
   */
  async saveEdits(
    id: string,
    input: unknown,
    options: { by: string; ifVersion: string | null; now?: Date },
  ): Promise<{ edits: StoredReplayEdits; version: string | undefined; changed: boolean }> {
    const span = await this.replaySpan(id);
    if (span === undefined) throw httpError(404, 'replay not found');
    assertReplayEdits(input, span);
    const next = normalizeEdits(input);
    const current = await this.readEdits(id);
    if (sameEdits(current.edits, next)) return { ...current, changed: false };
    const conflict = () =>
      Object.assign(httpError(409, 'the edits changed since they were loaded'), { current: current.edits, version: current.version });
    if ((current.version ?? null) !== options.ifVersion) throw conflict();
    const stored: StoredReplayEdits = {
      ...next,
      revision: current.edits.revision + 1,
      updatedBy: options.by,
      updatedAt: (options.now ?? new Date()).toISOString(),
    };
    try {
      const info = await this.storage.write(this.editsKey(id), `${JSON.stringify(stored)}\n`, {
        contentType: JSON_TYPE,
        ...(current.version === undefined ? { createOnly: true } : { ifVersion: current.version }),
      });
      return { edits: stored, version: info.version, changed: true };
    } catch (error) {
      if (!(error instanceof PreconditionFailedError || error instanceof ObjectExistsError)) throw error;
      // Another replica saved first: its list wins unless it is this very list (a retry that raced itself).
      const latest = await this.readEdits(id);
      if (sameEdits(latest.edits, next)) return { ...latest, changed: false };
      throw Object.assign(httpError(409, 'the edits changed since they were loaded'), { current: latest.edits, version: latest.version });
    }
  }

  // Keep (no expiry) and retention

  /**
   * `kept` and `expiresAt` for one replay (`committed` for a sample shipped with the app, which never
   * expires and cannot be kept); undefined when there is no such replay.
   */
  async replayRetention(id: string): Promise<(Retention & { committed?: true }) | undefined> {
    const summary = await this.summary(id);
    if (!summary) return undefined;
    const committed = !(await this.storage.stat(this.replayKey(id)));
    return { ...(summary.kept ? { kept: summary.kept } : {}), expiresAt: summary.expiresAt ?? null, ...(committed ? { committed } : {}) };
  }

  /** Pins an uploaded replay (no expiry), recording who; idempotent (the first keeper stays recorded). */
  async keep(id: string, by: string, now = new Date()) {
    assertReplayId(id);
    if (!(await this.storage.stat(this.replayKey(id)))) {
      if (await this.samples.stat(this.sampleKey(id))) throw httpError(409, 'committed samples never expire');
      throw httpError(404, 'replay not found');
    }
    const record: KeepRecord = { by, at: now.toISOString() };
    await this.storage
      .write(this.keepKey(id), `${JSON.stringify(record)}\n`, { createOnly: true, contentType: JSON_TYPE })
      .catch((error: unknown) => {
        if (!(error instanceof ObjectExistsError)) throw error;
      });
    this.changed();
    return (await this.replayRetention(id))!;
  }

  async unkeep(id: string) {
    assertReplayId(id);
    if (!(await this.locate(id))) throw httpError(404, 'replay not found');
    await this.storage.delete(this.keepKey(id));
    this.keepCache.delete(this.keepKey(id));
    this.changed();
    return (await this.replayRetention(id))!;
  }

  /**
   * A suite's age counts from its file's server time (`createdAt` comes from the reviewer's clock). Suite
   * files are rewritten as runs register, so that is the last registration: never earlier than the upload.
   */
  private async suiteRetentionOf(suite: ReviewSuite): Promise<Retention> {
    const key = this.suiteKeepKey(suite.id);
    const [info, keepInfo] = await Promise.all([this.storage.stat(this.suiteKey(suite.id)), this.storage.stat(key)]);
    const keep = await this.keepOf(key, keepInfo);
    return retentionOf(this.retention, {
      uploadedMs: info?.createdMs ?? Number.NaN,
      ...(keep ? { kept: keep } : {}),
    });
  }

  async suiteRetention(id: string): Promise<Retention | undefined> {
    const suite = await this.loadSuite(id);
    return suite ? this.suiteRetentionOf(suite) : undefined;
  }

  /** Pins a review suite: it and its runs' replays never expire. */
  async keepSuite(id: string, by: string, now = new Date()) {
    if (!(await this.loadSuite(id))) throw httpError(404, 'review suite not found');
    const record: KeepRecord = { by, at: now.toISOString() };
    await this.storage
      .write(this.suiteKeepKey(id), `${JSON.stringify(record)}\n`, { createOnly: true, contentType: JSON_TYPE })
      .catch((error: unknown) => {
        if (!(error instanceof ObjectExistsError)) throw error;
      });
    this.changed();
    return (await this.suiteRetention(id))!;
  }

  async unkeepSuite(id: string) {
    if (!(await this.loadSuite(id))) throw httpError(404, 'review suite not found');
    await this.storage.delete(this.suiteKeepKey(id));
    this.keepCache.delete(this.suiteKeepKey(id));
    this.changed();
    return (await this.suiteRetention(id))!;
  }

  /**
   * Deletes what has expired (src/shared/retention.ts) from the server's upload time; kept
   * replays and suites, the runs of kept suites and committed samples never.
   * Prefixes without a replay.json (an interrupted upload) expire by their newest object, at the default.
   * The app's sweep is the only deleter (a bucket lifecycle rule cannot see Keep), so every
   * run logs one `retention sweep:` line to alert on when it stops (docs/operations.md).
   */
  async prune(now = Date.now()) {
    // Its own trace (the interval, startup or an upload's pruneSoon), linked to the request that triggered it.
    return withSpan(
      'retention.sweep',
      {},
      async (span) => {
        const started = Date.now();
        const objects = await this.storage.list();
        const groups = new Map<string, ObjectInfo[]>();
        for (const object of objects) {
          const id = object.key.split('/')[0]!;
          if (id === '_suites' || !ID.test(id)) continue;
          groups.set(id, [...(groups.get(id) ?? []), object]);
        }
        const suiteKeys = objects.filter((object) => object.key.startsWith('_suites/'));
        const keptSuites = new Map<string, ObjectInfo>();
        for (const object of suiteKeys) {
          const match = /^_suites\/([a-z0-9][a-z0-9-]{0,79})\.keep\.json$/.exec(object.key);
          if (match) keptSuites.set(match[1]!, object);
        }
        const keptBySuite = keptSuites.size ? await this.keptSuiteReplays(keptSuites) : new Set<string>();

        const removed: string[] = [];
        for (const [id, group] of groups) {
          const name = (file: string) => group.find((object) => object.key === `${id}/${file}`);
          if (name('keep.json') || keptBySuite.has(id)) continue;
          const replay = name('replay.json');
          // A committed sample's sidecars (its edit list) live as long as the sample: forever.
          if (!replay && (await this.samples.stat(this.sampleKey(id)))) continue;
          let expires: number | undefined;
          if (replay) {
            expires = expiryMs(this.retention, { uploadedMs: replay.createdMs });
          } else {
            const newest = Math.max(...group.map((object) => object.updatedMs));
            expires = expiryMs(this.retention, { uploadedMs: newest });
          }
          if (expires === undefined || expires >= now) continue;
          await this.storage.deletePrefix(`${id}/`);
          this.summaryCache.delete(id);
          this.keepCache.delete(this.keepKey(id));
          removed.push(id);
        }

        let suites = 0;
        for (const object of suiteKeys) {
          const match = /^_suites\/([a-z0-9][a-z0-9-]{0,79})\.json$/.exec(object.key);
          if (!match) continue;
          suites++;
          if (keptSuites.has(match[1]!)) continue;
          const expires = expiryMs(this.retention, { uploadedMs: object.createdMs });
          if (expires !== undefined && expires < now) {
            await this.storage.delete(object.key);
            removed.push(`suite:${match[1]}`);
          }
        }
        this.lastPrune = now;
        if (removed.length) this.changed();
        const removedSuites = removed.filter((id) => id.startsWith('suite:')).length;
        span.setAttributes({
          'retention.replays': groups.size,
          'retention.replays_removed': removed.length - removedSuites,
          'retention.suites': suites,
          'retention.suites_removed': removedSuites,
        });
        console.log(
          `retention sweep: removed ${removed.length - removedSuites} of ${groups.size} replays and ${removedSuites} of ${suites} suites in ${Date.now() - started} ms`,
        );
        return removed;
      },
      { root: true, links: [captureLink()] },
    );
  }

  /** A prune after an upload, at most every ten minutes and never two at once; errors are logged, not thrown. */
  pruneSoon(now = Date.now()) {
    if (this.pruning || now - this.lastPrune < PRUNE_THROTTLE_MS) return this.pruning;
    this.lastPrune = now;
    this.pruning = this.prune(now)
      .catch((error: unknown) => {
        console.error('prune failed:', error);
        return [];
      })
      .finally(() => {
        this.pruning = undefined;
      });
    return this.pruning;
  }
}
