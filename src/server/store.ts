import { assertReplayEdits, normalizeEdits, type StoredReplayEdits } from '../shared/edits.ts';
import { DEFAULT_EXPIRED_DAYS, type ExpiredReplays } from '../shared/expired.ts';
import { profilesOf } from '../shared/profiles.ts';
import {
  assertReplayBundle,
  assertReplayId,
  matchesFilters,
  type ReplayBundle,
  type ReplayFilters,
  type ReplaySummary,
} from '../shared/replay.ts';
import { DEFAULT_RETENTION, type KeepRecord, type Retention, type RetentionPolicy } from '../shared/retention.ts';
import {
  assertReviewRunRegistration,
  type ResolvedSuiteRegistration,
  type ReviewRunRegistration,
  type ReviewSuite,
  type ReviewSuiteIndexEntry,
  type ReviewSuiteSummary,
  summarizeReviewSuite,
} from '../shared/review-suite.ts';
import { type ReplayMetaPatch, type TrashRecord } from '../shared/schemas/replay-meta.ts';
import { isThumbHash } from '../shared/thumbhash.ts';
import { ExpiredLedger } from './expired.ts';
import { ProfileCatalog } from './profiles.ts';
import { nextOverrides, parseTrash, trashExpiryMs } from './replay-meta.ts';
import { FsStorage, ObjectExistsError, type ObjectStorage, readJson } from './storage/index.ts';
import { mapLimited, orAbsent } from './store/async.ts';
import { Bundles, type LocatedReplay } from './store/bundles.ts';
import { readEdits, saveEdits } from './store/edits.ts';
import * as keys from './store/keys.ts';
import { Listing, READ_CONCURRENCY } from './store/listing.ts';
import { Sidecars } from './store/sidecars.ts';
import { attachableRun, registration, withRecording, withRun } from './store/suite-changes.ts';
import { SuiteFiles } from './store/suites.ts';
import { sweepExpired } from './store/sweep.ts';
import type { SummaryFieldsRunner } from './summary-fields.ts';

export type { ReplaySummary } from '../shared/replay.ts';
export type { LocatedReplay } from './store/bundles.ts';
export { OPEN_STILL_VERSION, POSTER_VERSION, type PosterChoice, posterTag, PREVIEW_VERSION } from './store/keys.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
/** Upload-triggered prunes run at most this often (the periodic one runs every six hours regardless). */
const PRUNE_THROTTLE_MS = 10 * 60_000;

export class ReplayConflictError extends Error {
  readonly status = 409;
  readonly expose = true;

  constructor(id: string) {
    super(`replay ${id} already exists`);
  }
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** A whole number of days (tests, scripts) or a policy object. */
function policyFrom(retention: number | Partial<RetentionPolicy> | undefined): RetentionPolicy {
  if (typeof retention === 'number') return { days: retention };
  return { ...DEFAULT_RETENTION, ...retention };
}

/**
 * Replays, their sidecars and media, and review suites, on an ObjectStorage (src/server/storage/): the
 * local DATA_DIR (`STORAGE=fs`) or an S3-compatible bucket (`STORAGE=s3`). Layout, identical on both
 * (keys in src/server/store/keys.ts):
 *
 *   <id>/replay.json               the bundle (immutable)
 *   <id>/meta.json                 its list summary (rebuilt when missing, stale, an older SUMMARY_VERSION or other summary fields)
 *   <id>/keep.json                 `{ by, at }` while someone keeps it (no expiry)
 *   <id>/edits.json                its edit list (src/shared/edits.ts): trims and cuts applied on playback and export
 *   <id>/overrides.json            title, tags and profile changed after upload
 *   <id>/trash.json                present while it is soft-deleted
 *   <id>/poster.v2[-<moment>].jpg, open.v1.jpg, preview.v2.mp4(.json), session.mp4, rendered-*.mp4, render-*.json
 *   _suites/<id>.json              a review suite
 *   _suites/<id>.keep.json         kept suite
 *   _expired/<id>.json             what is left of a replay retention removed, for RETENTION_EXPIRED_DAYS (expired.ts)
 *
 * Committed samples (`sample/<id>.json`) are part of the code, read-only, and never expire.
 */
export class ReplayStore {
  readonly storage: ObjectStorage;
  readonly samples: FsStorage;
  readonly sampleDir: string;
  readonly retention: RetentionPolicy;
  /** The deployment's profiles: listed summaries get their (inferred) profile from here. Empty by default. */
  readonly profiles: ProfileCatalog;
  /**
   * How long the unfiltered list is reused (the backend's `listCacheMs` unless given): with S3 a list is a few API pages,
   * so the index's bursts (filters, Back) share one. This process's own writes clear it; another replica's show up
   * within the TTL. 0 (fs, memory) lists every time.
   */
  readonly listTtlMs: number;
  private readonly bundles: Bundles;
  private readonly sidecars: Sidecars;
  private readonly suites: SuiteFiles;
  private readonly listing: Listing;
  private readonly expired: ExpiredLedger;
  private listed: { at: number; summaries: Promise<ReplaySummary[]> } | undefined;
  private lastPrune = 0;
  private pruning: Promise<string[]> | undefined;

  constructor(
    data: string | ObjectStorage,
    sampleDir: string,
    retention?: number | Partial<RetentionPolicy>,
    options: {
      listTtlMs?: number;
      profiles?: ProfileCatalog;
      /** @deprecated Use `profiles`. */
      purposes?: ProfileCatalog;
      /** Plugins' `summaryFields` (src/server/summary-fields.ts): run whenever a summary is built, into `summary.ext`. */
      summaryFields?: SummaryFieldsRunner;
    } = {},
  ) {
    this.storage = typeof data === 'string' ? new FsStorage(data) : data;
    this.sampleDir = sampleDir;
    this.samples = new FsStorage(sampleDir);
    this.retention = policyFrom(retention);
    this.profiles = profilesOf(options) ?? new ProfileCatalog();
    this.listTtlMs = options.listTtlMs ?? Math.max(0, Number(this.storage.listCacheMs) || 0);
    this.bundles = new Bundles(this.storage, this.samples);
    this.sidecars = new Sidecars({ storage: this.storage, load: (id) => this.load(id), summaryFields: options.summaryFields });
    this.suites = new SuiteFiles(this.storage);
    const sources = { storage: this.storage, samples: this.samples, retention: this.retention, profiles: this.profiles };
    this.listing = new Listing({ ...sources, sidecars: this.sidecars, suites: this.suites });
    this.expired = new ExpiredLedger(this.storage, this.retention.expiredDays ?? DEFAULT_EXPIRED_DAYS);
  }

  /** Replays retention removed, still on record (`GET /api/expired-replays`). */
  async expiredReplays(): Promise<ExpiredReplays> {
    return { days: this.expired.days, records: await this.expired.list() };
  }

  /** Derives the same summary the list uses, without reading/writing cached sidecars or retention metadata. */
  async listSummary(bundle: ReplayBundle): Promise<ReplaySummary> {
    return this.profiles.apply(await this.sidecars.summarize(bundle));
  }

  /** @deprecated Use `profiles`. */
  get purposes(): ProfileCatalog {
    return this.profiles;
  }

  /** DATA_DIR with the fs driver; tests and scripts only. */
  get dataDir() {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no data directory with STORAGE=${this.storage.kind}`);
    return this.storage.root;
  }

  replayKey(id: string) {
    return keys.replayKey(id);
  }

  metaKey(id: string) {
    return keys.metaKey(id);
  }

  keepKey(id: string) {
    return keys.keepKey(id);
  }

  editsKey(id: string) {
    return keys.editsKey(id);
  }

  overridesKey(id: string) {
    return keys.overridesKey(id);
  }

  trashKey(id: string) {
    return keys.trashKey(id);
  }

  suiteKey(id: string) {
    return keys.suiteKey(id);
  }

  suiteKeepKey(id: string) {
    return keys.suiteKeepKey(id);
  }

  posterKey(id: string, choice?: keys.PosterChoice) {
    return keys.posterKey(id, choice);
  }

  openStillKey(id: string) {
    return keys.openStillKey(id);
  }

  previewKey(id: string) {
    return keys.previewKey(id);
  }

  videoKey(id: string) {
    return keys.videoKey(id);
  }

  /** The files behind the keys above, with the fs driver only (tests). */
  posterFile(id: string, choice?: keys.PosterChoice) {
    return this.fsPath(keys.posterKey(id, choice));
  }

  openStillFile(id: string) {
    return this.fsPath(keys.openStillKey(id));
  }

  previewFile(id: string) {
    return this.fsPath(keys.previewKey(id));
  }

  videoFile(id: string) {
    return this.fsPath(keys.videoKey(id));
  }

  private fsPath(key: string) {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no local files with STORAGE=${this.storage.kind}`);
    return this.storage.path(key);
  }

  async loadSuite(id: string): Promise<ReviewSuite | undefined> {
    return this.suites.load(id);
  }

  async listSuites(limit = 100): Promise<ReviewSuite[]> {
    return this.suites.list(limit);
  }

  async listSuiteSummaries(limit = 20): Promise<ReviewSuiteSummary[]> {
    const suites = await this.listSuites(limit);
    return Promise.all(suites.map(async (suite) => ({ ...summarizeReviewSuite(suite), ...(await this.listing.suiteRetention(suite)) })));
  }

  /** Suite summaries with their runs and each run's replay summary, for the grouped index. */
  async listSuiteIndex(limit = 100): Promise<ReviewSuiteIndexEntry[]> {
    // why: runs' replays come from the memoized list (one lookup each), not three stats per run.
    const [suites, summaries] = await Promise.all([this.listSuites(limit), this.list()]);
    const listed = new Map(summaries.map((summary) => [summary.id, summary]));
    return mapLimited(suites, READ_CONCURRENCY, (suite) => this.listing.suiteEntry(suite, listed));
  }

  /** One suite as the index (and the suite workspace) lists it: summary plus runs with their replays' summaries. */
  async suiteIndexEntry(suite: ReviewSuite, listed?: ReadonlyMap<string, ReplaySummary>): Promise<ReviewSuiteIndexEntry> {
    return this.listing.suiteEntry(suite, listed);
  }

  async registerSuite(id: string, input: ResolvedSuiteRegistration) {
    return this.suites.update(id, (current) => registration(current?.suite, id, input));
  }

  async registerRun(suiteId: string, runId: string, input: ReviewRunRegistration) {
    assertReviewRunRegistration(input, runId);
    return this.suites.mutate(suiteId, (suite) => withRun(suite, runId, input));
  }

  async assertSuiteRunCanAttach(suiteId: string, runId: string, replayId: string) {
    const suite = await this.loadSuite(suiteId);
    const run = attachableRun(suite, runId, replayId);
    return { suite, run };
  }

  async attachReplay(suiteId: string, runId: string, bundle: ReplayBundle) {
    return this.suites.mutate(suiteId, (suite) => withRecording(suite, runId, bundle));
  }

  async load(id: string): Promise<ReplayBundle | undefined> {
    return this.bundles.load(id);
  }

  /**
   * Where a replay's JSON lives (upload first, then committed sample), without reading it. `uploaded`
   * bundles are immutable: save() refuses an existing id (409), so a stored id never changes content.
   */
  async locate(id: string): Promise<LocatedReplay | undefined> {
    return this.bundles.locate(id);
  }

  async save(bundle: ReplayBundle) {
    assertReplayBundle(bundle);
    const id = bundle.meta.id;
    if (await this.samples.stat(keys.sampleKey(id))) throw new ReplayConflictError(id);
    await this.createOnly(id, keys.replayKey(id), `${JSON.stringify(bundle)}\n`, JSON_TYPE);
    const summary = await this.sidecars.summarize(bundle);
    await this.sidecars.writeSummary(id, summary).catch((error: unknown) => console.error('meta.json write failed:', error));
    await orAbsent(this.expired.forget(id));
    this.changed();
    return keys.replayKey(id);
  }

  async saveVideo(id: string, body: Buffer) {
    assertReplayId(id);
    if (await this.samples.stat(keys.sampleKey(id))) throw new ReplayConflictError(id);
    if (!(await this.storage.stat(keys.replayKey(id)))) throw httpError(404, `replay ${id} does not exist`);
    await this.createOnly(id, keys.videoKey(id), body, 'video/mp4');
    return keys.videoKey(id);
  }

  /** invariant: uploaded objects are immutable; a second write of the same key is a 409, never an overwrite. */
  private async createOnly(id: string, key: string, body: string | Buffer, contentType: string) {
    try {
      await this.storage.write(key, body, { createOnly: true, contentType });
    } catch (error) {
      if (error instanceof ObjectExistsError) throw new ReplayConflictError(id);
      throw error;
    }
  }

  /** A `{ by, at }` marker (keep, trash); idempotent, so the first writer stays recorded. */
  private async mark(key: string, record: KeepRecord | TrashRecord) {
    await this.storage.write(key, `${JSON.stringify(record)}\n`, { createOnly: true, contentType: JSON_TYPE }).catch((error: unknown) => {
      if (!(error instanceof ObjectExistsError)) throw error;
    });
    this.changed();
  }

  /**
   * Keeps a freshly rendered poster's ThumbHash with the replay's summary, so the list paints it before the poster
   * loads. Uploads keep it in meta.json; read-only samples read it from their poster's sidecar.
   */
  async setThumbHash(id: string, thumbhash: string) {
    if (!isThumbHash(thumbhash)) return;
    const replay = await this.storage.stat(keys.replayKey(id));
    if (!replay) {
      this.sidecars.forgetSummary(`sample:${id}`);
      this.changed();
      return;
    }
    const stored = await this.sidecars.uploaded(id, replay, await this.storage.stat(keys.metaKey(id)));
    if (!stored || stored.thumbhash === thumbhash) return;
    await this.sidecars.writeSummary(id, { ...stored, thumbhash });
    this.sidecars.forgetSummary(id);
    this.changed();
  }

  /**
   * The replay's summary, with `kept` and `expiresAt`. `suites: false` skips looking for a kept suite
   * holding it (the suite index knows its own suite's state).
   */
  async summary(id: string, { suites = true }: { suites?: boolean } = {}): Promise<ReplaySummary | undefined> {
    assertReplayId(id);
    return this.listing.summary(id, suites);
  }

  async list(filters: ReplayFilters = {}): Promise<ReplaySummary[]> {
    const now = Date.now();
    if (!this.listed || this.listTtlMs <= 0 || now - this.listed.at >= this.listTtlMs) {
      const pending = this.listing.all();
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

  /**
   * The replay's span on the player's clock (the rrweb track's length), which every edit time is measured on;
   * undefined when there is no such replay. Cached per bundle version: a save does not reparse the bundle.
   */
  async replaySpan(id: string): Promise<number | undefined> {
    return this.bundles.span(id);
  }

  /** The stored edit list and its version; unreadable sidecars must never be replaced by a save. */
  async readEdits(id: string): Promise<{ edits: StoredReplayEdits; version: string | undefined }> {
    return readEdits(this.storage, keys.editsKey(id));
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
    return saveEdits(this.storage, keys.editsKey(id), normalizeEdits(input), options);
  }

  /**
   * `kept` and `expiresAt` for one replay (`committed` for a sample shipped with the app, which never
   * expires and cannot be kept); undefined when there is no such replay.
   */
  async replayRetention(id: string): Promise<(Retention & { committed?: true }) | undefined> {
    const summary = await this.summary(id);
    if (!summary) return undefined;
    const committed = !(await this.storage.stat(keys.replayKey(id)));
    return { ...(summary.kept ? { kept: summary.kept } : {}), expiresAt: summary.expiresAt ?? null, ...(committed ? { committed } : {}) };
  }

  /** Pins an uploaded replay (no expiry), recording who; idempotent (the first keeper stays recorded). */
  async keep(id: string, by: string, now = new Date()) {
    assertReplayId(id);
    if (!(await this.storage.stat(keys.replayKey(id)))) {
      if (await this.samples.stat(keys.sampleKey(id))) throw httpError(409, 'committed samples never expire');
      throw httpError(404, 'replay not found');
    }
    await this.mark(keys.keepKey(id), { by, at: now.toISOString() });
    return this.currentRetention(id);
  }

  async unkeep(id: string) {
    assertReplayId(id);
    if (!(await this.locate(id))) throw httpError(404, 'replay not found');
    await this.storage.delete(keys.keepKey(id));
    this.sidecars.forgetKeep(keys.keepKey(id));
    this.changed();
    return this.currentRetention(id);
  }

  private async currentRetention(id: string): Promise<Retention & { committed?: true }> {
    const retention = await this.replayRetention(id);
    if (!retention) throw httpError(404, 'replay not found');
    return retention;
  }

  /** Uploaded, not deleted: the only replays whose meta can change or that can be deleted. */
  private async assertWritable(id: string) {
    assertReplayId(id);
    const [replay, trashed] = await Promise.all([this.storage.stat(keys.replayKey(id)), this.storage.stat(keys.trashKey(id))]);
    if (replay && !trashed) return;
    if (!replay && (await this.samples.stat(keys.sampleKey(id)))) throw httpError(409, 'committed samples are read-only');
    throw httpError(404, 'replay not found');
  }

  private async listedSummary(id: string): Promise<ReplaySummary> {
    const summary = await this.summary(id);
    if (!summary) throw httpError(404, 'replay not found');
    return summary;
  }

  /** Changes a replay's title, tags or profile (`profile: null` drops the override); returns its summary as listed. */
  async updateMeta(id: string, patch: ReplayMetaPatch, by: string, now = new Date()): Promise<ReplaySummary> {
    await this.assertWritable(id);
    const profile = patch.profile ?? patch.purpose;
    const problem = profile ? this.profiles.problem(profile) : undefined;
    if (problem) throw httpError(400, problem.replace('replay.meta.profile', 'profile'));
    const current = await this.sidecars.overrides(id, await this.storage.stat(keys.overridesKey(id)));
    const next = nextOverrides(current, patch, by, now);
    await this.storage.write(keys.overridesKey(id), `${JSON.stringify(next)}\n`, { contentType: JSON_TYPE });
    this.sidecars.forgetOverrides(id);
    this.changed();
    return this.listedSummary(id);
  }

  /**
   * Soft-deletes a replay: it leaves the list and its URLs answer 404, and it is restorable for TRASH_DAYS from now.
   * A kept replay (or one kept through its suite) refuses: release it first.
   */
  async trash(id: string, by: string, now = new Date()): Promise<{ trashed: TrashRecord; restorableUntil: string }> {
    await this.assertWritable(id);
    const kept = Boolean(await this.storage.stat(keys.keepKey(id))) || (await this.suites.keptReplays()).has(id);
    if (kept) throw httpError(409, 'release the keep before deleting this replay');
    const record: TrashRecord = { by, at: now.toISOString() };
    await this.mark(keys.trashKey(id), record);
    const stored = parseTrash(await readJson(this.storage, keys.trashKey(id)).catch(() => null)) ?? record;
    return { trashed: stored, restorableUntil: new Date(trashExpiryMs(Date.parse(stored.at))).toISOString() };
  }

  /** Takes a replay out of the trash. */
  async restore(id: string): Promise<ReplaySummary> {
    assertReplayId(id);
    if (!(await this.storage.stat(keys.trashKey(id)))) throw httpError(404, 'replay is not deleted');
    await this.storage.delete(keys.trashKey(id));
    this.changed();
    return this.listedSummary(id);
  }

  async suiteRetention(id: string): Promise<Retention | undefined> {
    const suite = await this.loadSuite(id);
    return suite ? this.listing.suiteRetention(suite) : undefined;
  }

  /** Pins a review suite: it and its runs' replays never expire. */
  async keepSuite(id: string, by: string, now = new Date()) {
    if (!(await this.loadSuite(id))) throw httpError(404, 'review suite not found');
    await this.mark(keys.suiteKeepKey(id), { by, at: now.toISOString() });
    return this.currentSuiteRetention(id);
  }

  async unkeepSuite(id: string) {
    if (!(await this.loadSuite(id))) throw httpError(404, 'review suite not found');
    await this.storage.delete(keys.suiteKeepKey(id));
    this.sidecars.forgetKeep(keys.suiteKeepKey(id));
    this.changed();
    return this.currentSuiteRetention(id);
  }

  private async currentSuiteRetention(id: string): Promise<Retention> {
    const retention = await this.suiteRetention(id);
    if (!retention) throw httpError(404, 'review suite not found');
    return retention;
  }

  /**
   * Deletes what has expired (src/shared/retention.ts) from the server's upload time; kept replays and suites, the runs
   * of kept suites and committed samples never. Logs one `retention sweep:` line per run (src/server/store/sweep.ts).
   */
  async prune(now = Date.now()) {
    const context = { storage: this.storage, samples: this.samples, retention: this.retention, profiles: this.profiles };
    const { removed } = await sweepExpired({ ...context, sidecars: this.sidecars, suites: this.suites, expired: this.expired }, now);
    this.lastPrune = now;
    if (removed.length) this.changed();
    return removed;
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
