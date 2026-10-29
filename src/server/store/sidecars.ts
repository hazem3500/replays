import { isReplaySummary, type ReplayBundle, type ReplaySummary, SUMMARY_VERSION, summarizeReplay } from '../../shared/replay.ts';
import type { KeepRecord } from '../../shared/retention.ts';
import type { MetaOverrides } from '../../shared/schemas/replay-meta.ts';
import { isThumbHash } from '../../shared/thumbhash.ts';
import { parseOverrides } from '../replay-meta.ts';
import { type ObjectInfo, type ObjectStorage, readJson } from '../storage/index.ts';
import type { SummaryFieldsRunner } from '../summary-fields.ts';
import { orAbsent } from './async.ts';
import { keepKey, metaKey, overridesKey, posterKey } from './keys.ts';

const JSON_TYPE = 'application/json; charset=utf-8';

interface Versioned<T> {
  version: string;
  value: T;
}

function parseKeep(value: unknown): KeepRecord | undefined {
  if (typeof value !== 'object' || value === null || !('by' in value) || !('at' in value)) return;
  const { by, at } = value;
  return typeof by === 'string' && typeof at === 'string' ? { by, at } : undefined;
}

async function cachedAt<T>(cache: Map<string, Versioned<T>>, key: string, version: string, read: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached?.version === version) return cached.value;
  const value = await read();
  cache.set(key, { version, value });
  return value;
}

/** What summaries are built from: the store's bundle reader and the plugins' summary fields. */
export interface SidecarSources {
  storage: ObjectStorage;
  load: (id: string) => Promise<ReplayBundle | undefined>;
  summaryFields: SummaryFieldsRunner | undefined;
}

/**
 * A replay's small JSON sidecars (`meta.json`, `keep.json`, `overrides.json`), parsed once per storage version so listing
 * ~2000 replays reads only what changed. Committed samples have no sidecars; their summaries are cached by file version.
 */
export class Sidecars {
  private readonly sources: SidecarSources;
  private readonly summaries = new Map<string, Versioned<ReplaySummary | undefined>>();
  private readonly keeps = new Map<string, Versioned<KeepRecord | undefined>>();
  private readonly overrideRecords = new Map<string, Versioned<MetaOverrides | undefined>>();

  constructor(sources: SidecarSources) {
    this.sources = sources;
  }

  /** A bundle's list summary, with the plugins' summary fields. */
  async summarize(bundle: ReplayBundle): Promise<ReplaySummary> {
    const summary = summarizeReplay(bundle);
    const fields = this.sources.summaryFields;
    if (!fields) return summary;
    const ext = await fields.derive(bundle);
    return { ...summary, extVersion: fields.version, ...(ext ? { ext } : {}) };
  }

  async writeSummary(id: string, summary: ReplaySummary): Promise<void> {
    await this.sources.storage.write(metaKey(id), `${JSON.stringify(summary)}\n`, { contentType: JSON_TYPE });
  }

  /**
   * An upload's summary from its `meta.json`, built lazily and rebuilt when older than `replay.json`, built by an older
   * SUMMARY_VERSION, or by other plugin summary fields.
   */
  async uploaded(id: string, replay: ObjectInfo, meta: ObjectInfo | undefined): Promise<ReplaySummary | undefined> {
    let parsed: unknown;
    if (meta && meta.updatedMs >= replay.updatedMs) {
      const cached = this.summaries.get(id);
      if (cached?.value && cached.version === meta.version) return cached.value;
      parsed = await orAbsent(readJson(this.sources.storage, metaKey(id)));
      if (this.isCurrent(parsed, id)) {
        this.summaries.set(id, { version: meta.version, value: parsed });
        return parsed;
      }
    }
    const bundle = await this.sources.load(id);
    if (!bundle) return;
    // why: the poster's ThumbHash is not derived from the bundle; a rebuilt summary keeps it until the poster changes.
    const thumbhash = isReplaySummary(parsed) && isThumbHash(parsed.thumbhash) ? { thumbhash: parsed.thumbhash } : {};
    const summary = { ...(await this.summarize(bundle)), ...thumbhash };
    await this.writeSummary(id, summary).catch((error: unknown) => console.error('meta.json backfill failed:', error));
    return summary;
  }

  async sample(id: string, sample: ObjectInfo): Promise<ReplaySummary | undefined> {
    return cachedAt(this.summaries, `sample:${id}`, sample.version, async () => {
      const bundle = await orAbsent(this.sources.load(id));
      const built = bundle && (await orAbsent(this.summarize(bundle)));
      // why: samples have no meta.json; their poster's sidecar (PosterQueue) is where a ThumbHash survives a restart.
      const sidecar = await orAbsent(readJson<{ thumbhash?: unknown }>(this.sources.storage, `${posterKey(id)}.json`));
      return built && isThumbHash(sidecar?.thumbhash) ? { ...built, thumbhash: sidecar.thumbhash } : built;
    });
  }

  async overrides(id: string, info: ObjectInfo | undefined): Promise<MetaOverrides | undefined> {
    if (!info) return;
    const key = overridesKey(id);
    return cachedAt(this.overrideRecords, key, info.version, async () =>
      parseOverrides(await readJson(this.sources.storage, key).catch(() => null)),
    );
  }

  async keep(key: string, info: ObjectInfo | undefined): Promise<KeepRecord | undefined> {
    if (!info) return;
    return cachedAt(this.keeps, key, info.version, async () => parseKeep(await orAbsent(readJson(this.sources.storage, key))));
  }

  /** why: a rewrite within the same millisecond keeps the sidecar's version, so a cached value would win. */
  forgetSummary(cacheKey: string): void {
    this.summaries.delete(cacheKey);
  }

  forgetKeep(key: string): void {
    this.keeps.delete(key);
  }

  forgetOverrides(id: string): void {
    this.overrideRecords.delete(overridesKey(id));
  }

  /** Drops everything cached for a replay whose files were removed. */
  forgetReplay(id: string): void {
    this.forgetSummary(id);
    this.forgetKeep(keepKey(id));
    this.forgetOverrides(id);
  }

  private isCurrent(parsed: unknown, id: string): parsed is ReplaySummary {
    return (
      isReplaySummary(parsed) &&
      parsed.id === id &&
      parsed.summaryVersion === SUMMARY_VERSION &&
      (parsed.extVersion ?? '') === (this.sources.summaryFields?.version ?? '')
    );
  }
}
