import { bundleSpan } from '../../shared/edits.ts';
import { assertReplayBundle, assertReplayId, type ReplayBundle } from '../../shared/replay.ts';
import type { ObjectInfo, ObjectStorage } from '../storage/index.ts';
import { replayKey, sampleKey, trashKey } from './keys.ts';

/** Where an id's bundle lives: an upload in the store, or a committed sample shipped with the code. */
export interface LocatedReplay {
  storage: ObjectStorage;
  key: string;
  info: ObjectInfo;
  /** Uploads are immutable (save() refuses an existing id); samples can change with a deploy. */
  uploaded: boolean;
}

/** Replay bundles: uploads first, then committed samples; a trashed upload hides both. */
export class Bundles {
  private readonly storage: ObjectStorage;
  private readonly samples: ObjectStorage;
  /** Replay spans (ms) keyed by source and id, valid while the bundle's version is unchanged. */
  private readonly spans = new Map<string, { version: string; span: number }>();

  constructor(storage: ObjectStorage, samples: ObjectStorage) {
    this.storage = storage;
    this.samples = samples;
  }

  async load(id: string): Promise<ReplayBundle | undefined> {
    assertReplayId(id);
    if (await this.storage.stat(trashKey(id))) return;
    for (const [storage, key] of [
      [this.storage, replayKey(id)],
      [this.samples, sampleKey(id)],
    ] as const) {
      const source = await storage.read(key);
      if (!source) continue;
      const bundle: unknown = JSON.parse(source.toString('utf8'));
      assertReplayBundle(bundle);
      return bundle;
    }
    return;
  }

  /** invariant: `uploaded` bundles are immutable, so a stored id never changes content. */
  async locate(id: string): Promise<LocatedReplay | undefined> {
    assertReplayId(id);
    const [uploaded, trashed] = await Promise.all([this.storage.stat(replayKey(id)), this.storage.stat(trashKey(id))]);
    if (trashed) return;
    if (uploaded) return { storage: this.storage, key: replayKey(id), info: uploaded, uploaded: true };
    const sample = await this.samples.stat(sampleKey(id));
    return sample ? { storage: this.samples, key: sampleKey(id), info: sample, uploaded: false } : undefined;
  }

  /** The replay's span on the player's clock; cached per bundle version, so an edit save does not reparse the bundle. */
  async span(id: string): Promise<number | undefined> {
    const located = await this.locate(id);
    if (!located) return;
    const cacheKey = `${located.uploaded ? 'upload' : 'sample'}:${id}`;
    const cached = this.spans.get(cacheKey);
    if (cached?.version === located.info.version) return cached.span;
    const bundle = await this.load(id);
    if (!bundle) return;
    const span = bundleSpan(bundle);
    this.spans.set(cacheKey, { version: located.info.version, span });
    return span;
  }
}
