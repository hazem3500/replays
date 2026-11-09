import { isReplaySummary, type ReplaySummary } from '../../shared/replay.ts';
import { type KeepRecord, type Retention, type RetentionPolicy, retentionOf } from '../../shared/retention.ts';
import { type ReviewSuite, type ReviewSuiteIndexEntry, summarizeReviewSuite } from '../../shared/review-suite.ts';
import type { ProfileCatalog } from '../profiles.ts';
import { withOverrides } from '../replay-meta.ts';
import type { ObjectInfo, ObjectStorage } from '../storage/index.ts';
import { serverUploadMs } from '../upload-age.ts';
import { mapLimited, orAbsent } from './async.ts';
import { keepKey, metaKey, overridesKey, REPLAY_ID, replayKey, sampleKey, suiteKeepKey, suiteKey, trashKey } from './keys.ts';
import type { Sidecars } from './sidecars.ts';
import type { SuiteFiles } from './suites.ts';

/** why: sidecar reads go a few dozen at a time, not 2000 sockets at once. */
export const READ_CONCURRENCY = 32;

const SIDECARS = ['replay', 'meta', 'keep', 'overrides', 'trash'] as const;
type SidecarName = (typeof SIDECARS)[number];

/** An upload's small JSON objects, as one listing or a few stats found them. */
type UploadFiles = { [Name in SidecarName]?: ObjectInfo | undefined };

const sidecarOf = (name: string): SidecarName | undefined => SIDECARS.find((sidecar) => `${sidecar}.json` === name);

const sampleIdOf = (object: ObjectInfo): string => object.key.slice(0, -'.json'.length);

function uploadFiles(objects: readonly ObjectInfo[]): Map<string, UploadFiles> {
  const uploads = new Map<string, UploadFiles>();
  for (const object of objects) {
    const [id = '', name = ''] = object.key.split('/');
    const sidecar = sidecarOf(name);
    if (REPLAY_ID.test(id) && sidecar) uploads.set(id, { ...uploads.get(id), [sidecar]: object });
  }
  return uploads;
}

/** Everything a listed summary is built from. */
export interface ListingSources {
  storage: ObjectStorage;
  samples: ObjectStorage;
  retention: RetentionPolicy;
  profiles: ProfileCatalog;
  sidecars: Sidecars;
  suites: SuiteFiles;
}

/** Replay summaries as the index lists them: overrides, profile, `kept` and `expiresAt` applied. */
export class Listing {
  private readonly sources: ListingSources;

  constructor(sources: ListingSources) {
    this.sources = sources;
  }

  /**
   * The replay's summary, with `kept` and `expiresAt`. `suites: false` skips looking for a kept suite holding it (the
   * suite index knows its own suite's state).
   */
  async summary(id: string, suites: boolean): Promise<ReplaySummary | undefined> {
    const { storage, samples } = this.sources;
    const [replay, meta, keep, overrides, trash] = await Promise.all(
      [replayKey, metaKey, keepKey, overridesKey, trashKey].map((key) => storage.stat(key(id))),
    );
    if (replay) {
      if (trash) return;
      const stored = await this.sources.sidecars.uploaded(id, replay, meta);
      const keptBySuite = async () => suites && (await this.sources.suites.keptReplays()).has(id);
      return stored && this.listed(id, stored, { replay, keep, overrides }, keptBySuite);
    }
    const sample = await samples.stat(sampleKey(id));
    return sample ? this.sample(id, sample) : undefined;
  }

  /** Every listed replay and committed sample, newest capture first; an unreadable upload is left out, not fatal. */
  async all(): Promise<ReplaySummary[]> {
    const { storage, samples, suites, sidecars } = this.sources;
    // why: one listing of just the small JSON objects (GCS matchGlob) is ~4 pages for 2000 replays, no media.
    const [objects, sampleObjects, suiteObjects] = await Promise.all([
      storage.list({ glob: '*/{replay,meta,keep,overrides,trash}.json' }),
      samples.list({ glob: '*.json' }),
      suites.objects(),
    ]);
    const keptBySuite = suiteObjects.kept.size ? await suites.keptReplays(suiteObjects.kept) : new Set<string>();
    const uploads = uploadFiles(objects);
    const live = [...uploads].filter(([, files]) => !files.trash);
    const [uploaded, committed] = await Promise.all([
      mapLimited(live, READ_CONCURRENCY, async ([id, { replay, ...files }]) => {
        const stored = replay && (await orAbsent(sidecars.uploaded(id, replay, files.meta)));
        return stored && this.listed(id, stored, { ...files, replay }, () => keptBySuite.has(id));
      }),
      Promise.all(
        sampleObjects
          .filter((object) => {
            const id = sampleIdOf(object);
            return REPLAY_ID.test(id) && !uploads.get(id)?.replay && !uploads.get(id)?.trash;
          })
          .map((object) => this.sample(sampleIdOf(object), object)),
      ),
    ]);
    return [...uploaded, ...committed]
      .filter((summary): summary is ReplaySummary => isReplaySummary(summary))
      .toSorted((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  /**
   * One suite as the index (and the suite workspace) lists it: summary plus runs with replay summaries. With `listed`
   * (the index), a run's replay is looked up there, and read on its own only when the memoized list does not have it yet.
   */
  async suiteEntry(suite: ReviewSuite, listed?: ReadonlyMap<string, ReplaySummary>): Promise<ReviewSuiteIndexEntry> {
    const retention = await this.suiteRetention(suite);
    const replayOf = async (replayId: string) => {
      const found = listed?.get(replayId) ?? (await orAbsent(this.summary(replayId, false)));
      // why: a kept suite keeps its runs' replays.
      return found && retention.kept ? { ...found, expiresAt: null } : found;
    };
    const runs = suite.runs.toSorted((a, b) => a.sequence - b.sequence);
    const runDetails = await Promise.all(
      runs.map(async ({ id, sequence, label, status, startedAt, finishedAt, replayId, summary }) => {
        const replay = replayId ? await replayOf(replayId) : undefined;
        return {
          id,
          sequence,
          label,
          status,
          startedAt,
          ...(finishedAt ? { finishedAt } : {}),
          ...(summary ? { summary } : {}),
          ...(replayId ? { replayId } : {}),
          ...(replay ? { replay } : {}),
        };
      }),
    );
    return { ...summarizeReviewSuite(suite), ...retention, runDetails };
  }

  /**
   * A suite's age counts from its file's server time (`createdAt` comes from the reviewer's clock). Suite files are
   * rewritten as runs register, so that is the last registration: never earlier than the upload.
   */
  async suiteRetention(suite: ReviewSuite): Promise<Retention> {
    const { storage, sidecars, retention } = this.sources;
    const key = suiteKeepKey(suite.id);
    const [info, keepInfo] = await Promise.all([storage.stat(suiteKey(suite.id)), storage.stat(key)]);
    const keep = await sidecars.keep(key, keepInfo);
    return retentionOf(retention, {
      uploadedMs: info ? await serverUploadMs(storage, info) : Number.NaN,
      ...(keep ? { kept: keep } : {}),
    });
  }

  private async listed(
    id: string,
    stored: ReplaySummary,
    files: UploadFiles & { replay: ObjectInfo },
    keptBySuite: () => boolean | Promise<boolean>,
  ): Promise<ReplaySummary> {
    const { sidecars, profiles } = this.sources;
    const summary = profiles.apply(withOverrides(stored, await sidecars.overrides(id, files.overrides)));
    const keep = await sidecars.keep(keepKey(id), files.keep);
    const bySuite = !keep && (await keptBySuite());
    return { ...summary, ...(await this.retention(summary, files.replay, keep, bySuite)) };
  }

  private async sample(id: string, object: ObjectInfo): Promise<ReplaySummary | undefined> {
    const summary = await this.sources.sidecars.sample(id, object);
    return summary ? { ...this.sources.profiles.apply(summary), expiresAt: null } : undefined;
  }

  private async retention(summary: ReplaySummary, replay: ObjectInfo, keep: KeepRecord | undefined, bySuite: boolean): Promise<Retention> {
    if (bySuite && !keep) return { expiresAt: null };
    return retentionOf(this.sources.retention, {
      uploadedMs: await serverUploadMs(this.sources.storage, replay),
      profile: summary.profile,
      profileInferred: summary.profileInferred,
      summary,
      ...(keep ? { kept: keep } : {}),
    });
  }
}
