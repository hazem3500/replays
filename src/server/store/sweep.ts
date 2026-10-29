import type { ReplaySummary } from '../../shared/replay.ts';
import { expiryMs, type RetentionPolicy, retentionDays } from '../../shared/retention.ts';
import type { ExpiredLedger } from '../expired.ts';
import type { ProfileCatalog } from '../profiles.ts';
import { trashExpiryMs } from '../replay-meta.ts';
import type { ObjectInfo, ObjectStorage } from '../storage/index.ts';
import { captureLink, withSpan } from '../tracing.ts';
import { serverUploadMs, uploadAgeKey } from '../upload-age.ts';
import { orAbsent } from './async.ts';
import { REPLAY_ID, sampleKey, SUITES_PREFIX } from './keys.ts';
import type { Sidecars } from './sidecars.ts';
import { type SuiteFiles, sortSuiteObjects } from './suites.ts';

/** Everything a retention sweep reads and deletes. */
export interface SweepContext {
  storage: ObjectStorage;
  samples: ObjectStorage;
  retention: RetentionPolicy;
  profiles: ProfileCatalog;
  sidecars: Sidecars;
  suites: SuiteFiles;
  expired: ExpiredLedger;
}

interface ReplayGroup {
  id: string;
  file: (name: string) => ObjectInfo | undefined;
  newestMs: number;
}

function replayGroups(objects: readonly ObjectInfo[]): ReplayGroup[] {
  const groups = new Map<string, ObjectInfo[]>();
  for (const object of objects) {
    const id = object.key.split('/', 1)[0] ?? '';
    if (!REPLAY_ID.test(id)) continue;
    groups.set(id, [...(groups.get(id) ?? []), object]);
  }
  return Array.from(groups, ([id, group]) => ({
    id,
    file: (name: string) => group.find((object) => object.key === `${id}/${name}`),
    newestMs: Math.max(...group.map((object) => object.updatedMs)),
  }));
}

/** why: a record that cannot be written must not keep the replay from being removed on time. */
async function recordExpired(context: SweepContext, summary: ReplaySummary, now: number): Promise<void> {
  const days = retentionDays(context.retention, { profile: summary.profile, profileInferred: summary.profileInferred, summary });
  await context.expired.record(summary, days, now).catch((error: unknown) => console.error('expired record write failed:', error));
}

async function removeReplay(context: SweepContext, id: string): Promise<void> {
  await context.storage.deletePrefix(`${id}/`);
  context.sidecars.forgetReplay(id);
}

/** When an upload expires, per profile and rule: its summary (sidecar, cached) says which applies. */
async function uploadExpiry(context: SweepContext, group: ReplayGroup, replay: ObjectInfo) {
  const stored = await orAbsent(context.sidecars.uploaded(group.id, replay, group.file('meta.json')));
  const summary = stored && context.profiles.apply(stored);
  const expires = expiryMs(context.retention, {
    uploadedMs: await serverUploadMs(context.storage, replay),
    profile: summary?.profile,
    profileInferred: summary?.profileInferred,
    summary,
  });
  return { expires, summary };
}

/**
 * Removes one replay prefix when it has expired: a trashed replay after its restore window, else by retention. Kept
 * replays, runs of kept suites and a committed sample's sidecars stay.
 */
async function sweepReplay(context: SweepContext, group: ReplayGroup, keptBySuite: Set<string>, now: number): Promise<boolean> {
  const trashed = group.file('trash.json');
  if (trashed && trashExpiryMs(trashed.updatedMs) < now) {
    await removeReplay(context, group.id);
    return true;
  }
  if (group.file('keep.json') || keptBySuite.has(group.id)) return false;
  const replay = group.file('replay.json');
  if (!replay && (await context.samples.stat(sampleKey(group.id)))) return false;
  // why: a prefix without replay.json is an interrupted upload; it expires by its newest object, at the default.
  const { expires, summary } = replay
    ? await uploadExpiry(context, group, replay)
    : { expires: expiryMs(context.retention, { uploadedMs: group.newestMs }), summary: undefined };
  if (expires === undefined || expires >= now) return false;
  if (summary) await recordExpired(context, summary, now);
  await removeReplay(context, group.id);
  return true;
}

async function sweepSuites(context: SweepContext, suites: readonly ObjectInfo[], kept: ReadonlyMap<string, ObjectInfo>, now: number) {
  const removed: string[] = [];
  for (const object of suites) {
    const id = object.key.slice(SUITES_PREFIX.length, -'.json'.length);
    if (kept.has(id)) continue;
    const expires = expiryMs(context.retention, { uploadedMs: await serverUploadMs(context.storage, object) });
    if (expires === undefined || expires >= now) continue;
    await context.storage.delete(object.key);
    await context.storage.delete(uploadAgeKey(object.key));
    removed.push(`suite:${id}`);
  }
  return removed;
}

/** The ids a sweep removed (suites as `suite:<id>`), and how many replays and suites it looked at. */
export interface SweepResult {
  removed: string[];
  replays: number;
  suites: number;
}

async function sweepAll(context: SweepContext, now: number): Promise<SweepResult> {
  const objects = await context.storage.list();
  const groups = replayGroups(objects);
  const { suites, kept } = sortSuiteObjects(objects.filter((object) => object.key.startsWith(SUITES_PREFIX)));
  const keptBySuite = kept.size ? await context.suites.keptReplays(kept) : new Set<string>();
  const removed: string[] = [];
  for (const group of groups) if (await sweepReplay(context, group, keptBySuite, now)) removed.push(group.id);
  removed.push(...(await sweepSuites(context, suites, kept, now)));
  await context.expired.prune(now).catch((error: unknown) => console.error('expired records prune failed:', error));
  return { removed, replays: groups.length, suites: suites.length };
}

/**
 * Deletes what has expired (src/shared/retention.ts) from the server's upload time. The app's sweep is the only deleter (a
 * bucket lifecycle rule cannot see Keep), so every run logs one `retention sweep:` line to alert on when it stops
 * (docs/operations.md). Its own trace, linked to whatever triggered it.
 */
export function sweepExpired(context: SweepContext, now: number): Promise<SweepResult> {
  return withSpan(
    'retention.sweep',
    {},
    async (span) => {
      const started = Date.now();
      const result = await sweepAll(context, now);
      const removedSuites = result.removed.filter((id) => id.startsWith('suite:')).length;
      const removedReplays = result.removed.length - removedSuites;
      span.setAttributes({
        'retention.replays': result.replays,
        'retention.replays_removed': removedReplays,
        'retention.suites': result.suites,
        'retention.suites_removed': removedSuites,
      });
      // oxlint-disable-next-line eslint/no-console -- why: operations alert on this stdout line when sweeps stop.
      console.log(
        `retention sweep: removed ${removedReplays} of ${result.replays} replays and ${removedSuites} of ${result.suites} suites in ${Date.now() - started} ms`,
      );
      return result;
    },
    { root: true, links: [captureLink()] },
  );
}
