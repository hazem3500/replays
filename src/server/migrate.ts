import { isDeepStrictEqual } from 'node:util';

import { sanitizeReplayBundle } from '../capture/sanitize.ts';
import type { RedactionRules } from '../shared/redaction.ts';
import { assertReplayBundle, type ReplayBundle, type ReplaySummary, summarizeReplay } from '../shared/replay.ts';
import { assertReviewSuite } from '../shared/review-suite.ts';
import type { ContextSchema } from './context-schema.ts';
import { ReplayStore } from './store.ts';
import { ObjectExistsError, type ObjectInfo, type ObjectStorage } from './storage/types.ts';

/*
 * Converting a stored data set into another store (`replays migrate`, docs/operations.md#converting-stored-replays).
 *
 * Every replay prefix (`<id>/replay.json` and its sidecars: comments, edits, keep marker, posters, previews, videos),
 * every review suite (`_suites/<id>.json` and its keep marker) and every other object (plugin data such as
 * `_malleable/`) is read from the source; replays (and suites) go through the translation, the core validator and the
 * server's privacy pass, and everything is written to the target create-only. A bundle that does not validate is
 * reported and nothing of its prefix is written. Re-running is safe: what the target already holds is left alone,
 * and an interrupted run resumes where it stopped.
 */

/** What a translation sees besides the raw JSON. */
export interface MigrateInfo {
  /** The replay or suite id (the prefix it was stored under). */
  id: string;
  /** The source key (`<id>/replay.json`, `_suites/<id>.json`). */
  key: string;
  /** Purpose ids the target deployment knows; empty when it has none (then a purpose belongs in `meta.tags`). */
  purposes: readonly string[];
}

/** Turns one stored document (parsed JSON) into its new shape; return it unchanged when there is nothing to do. */
export type MigrateTranslate = (raw: unknown, info: MigrateInfo) => unknown;

export interface MigrateOptions {
  from: ObjectStorage | ReplayStore;
  to: ObjectStorage | ReplayStore;
  /** Applied to every `replay.json`; the result must pass the core validator. Default: identity. */
  translate?: MigrateTranslate;
  /** Applied to every `_suites/<id>.json`; the result must pass the suite validator. Default: identity. */
  translateSuite?: MigrateTranslate;
  /** Validate `context.fields` against the target's schema too (the CLI passes the config's). */
  contextSchema?: ContextSchema;
  /** Passed to the translation as `info.purposes`. */
  purposes?: readonly string[];
  /** Additional privacy rules from the target deployment, applied with the built-in defaults. */
  redaction?: RedactionRules;
  /** Read, translate and validate everything, write nothing; the report says what would be written. */
  dryRun?: boolean;
  /** Prefixes processed at once (default 4). */
  concurrency?: number;
  onProgress?(progress: MigrateProgress): void;
}

export type MigrateKind = 'replay' | 'suite' | 'objects';

export interface MigrateProgress {
  id: string;
  kind: MigrateKind;
  status: 'converted' | 'unchanged' | 'failed';
  done: number;
  total: number;
}

export interface MigratedEntry {
  id: string;
  /** `objects`: a prefix without a bundle (a committed sample's comments or edits, plugin data such as `_malleable`). */
  kind: MigrateKind;
  /** The translation changed the document (or the privacy pass did). */
  translated: boolean;
  /** Keys written to the target (with `dryRun`: that would be written). */
  written: string[];
}

export interface MigrateReport {
  dryRun: boolean;
  /** Something was written for these. */
  converted: MigratedEntry[];
  /** The target already holds all of it. */
  unchanged: Array<{ id: string; kind: MigrateKind }>;
  /** Not written (or only partly, for a write error), with the reason. */
  failed: Array<{ id: string; kind: MigrateKind; reason: string }>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SUITE = /^_suites\/([a-z0-9][a-z0-9-]{0,79})(\.keep)?\.json$/;

const storageOf = (value: ObjectStorage | ReplayStore) => (value instanceof ReplayStore ? value.storage : value);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const json = (value: unknown) => `${JSON.stringify(value)}\n`;

function contentType(key: string) {
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.jpg')) return 'image/jpeg';
  if (key.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

interface Unit {
  id: string;
  kind: MigrateKind;
  /** The document that is translated (replay.json, the suite file); absent for `objects`. */
  main?: ObjectInfo;
  /** Copied verbatim. */
  others: ObjectInfo[];
}

/** One listing of the source, grouped the way the store lays data out (src/server/store.ts). */
function plan(objects: ObjectInfo[]): Unit[] {
  const replays = new Map<string, Unit>();
  const suites = new Map<string, Unit>();
  const other = new Map<string, Unit>();
  for (const object of objects) {
    // In-flight temporary files of the fs driver; a crash can leave them behind.
    if (object.key.endsWith('.tmp')) continue;
    const [top, name] = object.key.split('/') as [string, string | undefined];
    const suite = SUITE.exec(object.key);
    if (suite) {
      const unit = suites.get(suite[1]!) ?? { id: suite[1]!, kind: 'suite' as const, others: [] };
      if (suite[2]) unit.others.push(object);
      else unit.main = object;
      suites.set(unit.id, unit);
    } else if (ID.test(top) && name !== undefined) {
      const unit = replays.get(top) ?? { id: top, kind: 'replay' as const, others: [] };
      // The list summary is rebuilt from the translated bundle, never copied.
      if (object.key === `${top}/replay.json`) unit.main = object;
      else if (object.key !== `${top}/meta.json`) unit.others.push(object);
      replays.set(top, unit);
    } else {
      const unit = other.get(top) ?? { id: top, kind: 'objects' as const, others: [] };
      unit.others.push(object);
      other.set(top, unit);
    }
  }
  // A prefix without its main document (a committed sample's comments or edits) is copied as plain objects.
  const grouped = [...replays.values(), ...suites.values()].map((unit) => (unit.main ? unit : { ...unit, kind: 'objects' as const }));
  return [...grouped, ...other.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function readOrThrow(storage: ObjectStorage, key: string) {
  const body = await storage.read(key);
  if (!body) throw new Error(`${key} disappeared while migrating`);
  return body;
}

/** The translated, validated and sanitized main document of a unit, as stored. */
async function convert(unit: Unit, body: Buffer, options: MigrateOptions): Promise<{ text: string; translated: boolean }> {
  const key = unit.main!.key;
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error(`${key} is not JSON`);
  }
  const original = structuredClone(raw);
  const info: MigrateInfo = { id: unit.id, key, purposes: options.purposes ?? [] };
  if (unit.kind === 'suite') {
    const next = options.translateSuite ? await options.translateSuite(raw, info) : raw;
    assertReviewSuite(next);
    if (next.id !== unit.id) throw new Error(`suite.id changed from ${unit.id} to ${String(next.id)}`);
    return { text: json(next), translated: !isDeepStrictEqual(next, original) };
  }
  const next = options.translate ? await options.translate(raw, info) : raw;
  assertReplayBundle(next);
  if (next.meta.id !== unit.id) throw new Error(`meta.id changed from ${unit.id} to ${String(next.meta.id)}`);
  const problem = next.context?.fields !== undefined ? options.contextSchema?.validate(next.context.fields) : undefined;
  if (problem) throw new Error(problem);
  // The same privacy pass an upload gets: stored data never depends on the translation having sanitized it.
  const bundle: ReplayBundle = sanitizeReplayBundle(next, options.redaction);
  assertReplayBundle(bundle);
  return { text: json(bundle), translated: !isDeepStrictEqual(bundle, original) };
}

/** Writes `body` create-only; true when it wrote (or, dry, would write). */
async function put(target: ObjectStorage, key: string, body: Buffer | string, dryRun: boolean) {
  if (dryRun) return true;
  try {
    await target.write(key, body, { createOnly: true, contentType: contentType(key) });
    return true;
  } catch (error) {
    // Another run (or the target's server) got there first: the target's object stays.
    if (error instanceof ObjectExistsError) return false;
    throw error;
  }
}

async function migrateUnit(unit: Unit, source: ObjectStorage, target: ObjectStorage, options: MigrateOptions) {
  const dryRun = Boolean(options.dryRun);
  // Everything is read and checked before the first write, so a failure leaves nothing of this prefix behind.
  const main = unit.main ? await convert(unit, await readOrThrow(source, unit.main.key), options) : undefined;
  let mainExists = false;
  if (main && unit.main) {
    const existing = await target.read(unit.main.key);
    mainExists = Boolean(existing);
    if (existing) {
      let same = false;
      try {
        same = isDeepStrictEqual(JSON.parse(existing.toString('utf8')), JSON.parse(main.text));
      } catch {
        // Unparsable in the target: not the same.
      }
      if (!same) throw new Error(`the target already holds a different ${unit.main.key}`);
    }
  }
  const written: string[] = [];
  // Sidecars first, the bundle last: a replay shows up in the target's list only once it is complete.
  for (const object of unit.others) {
    if (await target.stat(object.key)) continue;
    const body = await readOrThrow(source, object.key);
    if (await put(target, object.key, body, dryRun)) written.push(object.key);
  }
  if (main && unit.main && !mainExists) {
    if (await put(target, unit.main.key, main.text, dryRun)) written.push(unit.main.key);
    if (unit.kind === 'replay' && written.includes(unit.main.key) && !dryRun) {
      const summary = summarizeReplay(JSON.parse(main.text) as ReplayBundle);
      // Best effort: the store rebuilds a missing or stale meta.json on its own.
      await target.write(`${unit.id}/meta.json`, json(summary), { contentType: contentType('.json') }).catch(() => undefined);
    }
  }
  return { written, translated: main?.translated ?? false };
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** At most `size` at a time, in order of `items`. */
async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(workers);
}

/**
 * Copies a whole store into another, translating every replay (and suite) on the way. Create-only, so it never
 * overwrites what the target holds: running it twice converts nothing the second time.
 *
 *   const report = await migrateStore({ from: new FsStorage('/backup'), to: gcs, translate, dryRun: true });
 */
export async function migrateStore(options: MigrateOptions): Promise<MigrateReport> {
  const source = storageOf(options.from);
  const target = storageOf(options.to);
  if (source === target) throw new Error('the source and the target are the same storage');
  const units = plan(await source.list());
  const report: MigrateReport = { dryRun: Boolean(options.dryRun), converted: [], unchanged: [], failed: [] };
  let done = 0;
  await pool(units, options.concurrency ?? 4, async (unit) => {
    let status: MigrateProgress['status'];
    try {
      const { written, translated } = await migrateUnit(unit, source, target, options);
      if (written.length) {
        report.converted.push({ id: unit.id, kind: unit.kind, translated, written });
        status = 'converted';
      } else {
        report.unchanged.push({ id: unit.id, kind: unit.kind });
        status = 'unchanged';
      }
    } catch (error) {
      report.failed.push({ id: unit.id, kind: unit.kind, reason: message(error) });
      status = 'failed';
    }
    done++;
    options.onProgress?.({ id: unit.id, kind: unit.kind, status, done, total: units.length });
  });
  report.converted.sort(byId);
  report.unchanged.sort(byId);
  report.failed.sort(byId);
  return report;
}

// Comparing two stores

/** A list summary as GET /api/replays shows it, without the retention fields (they count from each store's write time). */
export type ComparableSummary = Omit<ReplaySummary, 'expiresAt' | 'summaryVersion'>;

export interface StoreComparison {
  onlyInSource: string[];
  onlyInTarget: string[];
  /** Ids whose summaries differ, field by field. */
  changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }>;
  identical: number;
}

/** Each replay's summary, built from the stored bundle as is (an old-format bundle too, as far as it goes). */
async function summaries(storage: ObjectStorage, concurrency: number) {
  const objects = await storage.list({ glob: '*/{replay,keep}.json' });
  const ids = [...new Set(objects.filter((object) => object.key.endsWith('/replay.json')).map((object) => object.key.split('/')[0]!))];
  const result = new Map<string, ComparableSummary | { unreadable: string }>();
  await pool(ids, concurrency, async (id) => {
    try {
      const bundle = JSON.parse((await readOrThrow(storage, `${id}/replay.json`)).toString('utf8')) as ReplayBundle;
      const { summaryVersion: _version, ...summary } = summarizeReplay(bundle);
      const keep = await storage.read(`${id}/keep.json`).catch(() => undefined);
      const kept = keep ? (JSON.parse(keep.toString('utf8')) as ReplaySummary['kept']) : undefined;
      result.set(id, { ...summary, ...(kept ? { kept } : {}) });
    } catch (error) {
      result.set(id, { unreadable: message(error) });
    }
  });
  return result;
}

/** The summary diff between two stores: what a conversion changed in the list (`replays migrate --compare`). */
export async function compareStores(options: {
  from: ObjectStorage | ReplayStore;
  to: ObjectStorage | ReplayStore;
  concurrency?: number;
}): Promise<StoreComparison> {
  const concurrency = options.concurrency ?? 8;
  const [before, after] = await Promise.all([
    summaries(storageOf(options.from), concurrency),
    summaries(storageOf(options.to), concurrency),
  ]);
  const comparison: StoreComparison = { onlyInSource: [], onlyInTarget: [], changed: [], identical: 0 };
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(id) as Record<string, unknown> | undefined;
    const to = after.get(id) as Record<string, unknown> | undefined;
    if (!to) comparison.onlyInSource.push(id);
    else if (!from) comparison.onlyInTarget.push(id);
    else {
      const fields = [...new Set([...Object.keys(from), ...Object.keys(to)])]
        .filter((field) => !isDeepStrictEqual(from[field], to[field]))
        .map((field) => ({ field, from: from[field], to: to[field] }));
      if (fields.length) comparison.changed.push({ id, fields });
      else comparison.identical++;
    }
  }
  return comparison;
}
