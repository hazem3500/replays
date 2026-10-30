import { type ObjectStorage, readJson } from '../storage/index.ts';
import { parseStateFile, type RenderOptions, type RenderSpeedOption, renderStateKey } from './render-names.ts';

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'failed';

/** A job's mirrored state: what a later process (or a status request) can learn about it. */
export interface StoredRenderState {
  status: RenderStatus;
  error?: string;
}

/** One render variant of one replay. */
export interface RenderVariantRef {
  id: string;
  speed: RenderSpeedOption;
  options: RenderOptions;
}

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const isMirrored = (status: unknown): status is 'queued' | 'rendering' | 'failed' =>
  status === 'queued' || status === 'rendering' || status === 'failed';

/** Render job states mirrored to storage as `<id>/render-<variant>.json`. */
export class RenderStates {
  private readonly storage: ObjectStorage;
  private readonly now: () => number;

  constructor(storage: ObjectStorage, now: () => number) {
    this.storage = storage;
    this.now = now;
  }

  /** why: a torn legacy write reads as no state rather than failing the request. */
  async read(ref: RenderVariantRef): Promise<StoredRenderState | undefined> {
    const state = await readJson<{ status?: unknown; error?: unknown }>(this.storage, renderStateKey(ref.id, ref.speed, ref.options)).catch(
      () => null,
    );
    if (!state || !isMirrored(state.status)) return;
    return { status: state.status, ...(typeof state.error === 'string' ? { error: state.error } : {}) };
  }

  async write(ref: RenderVariantRef, state: StoredRenderState): Promise<void> {
    await this.storage.write(
      renderStateKey(ref.id, ref.speed, ref.options),
      `${JSON.stringify({ ...state, updatedAt: new Date(this.now()).toISOString() })}\n`,
      { contentType: 'application/json; charset=utf-8' },
    );
  }

  async remove(ref: RenderVariantRef): Promise<void> {
    await this.storage.delete(renderStateKey(ref.id, ref.speed, ref.options));
  }

  /** Marks jobs a previous process left queued or rendering as failed, so a POST retries them; returns how many. */
  async recover(): Promise<number> {
    const objects = await this.storage.list({ glob: '*/render-*.json' });
    let recovered = 0;
    for (const object of objects) {
      const [id = '', file = ''] = object.key.split('/');
      const parsed = REPLAY_ID.test(id) ? parseStateFile(file) : undefined;
      if (!parsed) continue;
      const ref = { id, ...parsed };
      const state = await this.read(ref);
      if (state?.status !== 'queued' && state?.status !== 'rendering') continue;
      await this.write(ref, { status: 'failed', error: 'interrupted by a server restart; export again to retry' });
      recovered++;
    }
    return recovered;
  }
}
