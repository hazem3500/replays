import type { RenderJob } from '../../plugin/types.ts';
import type { RenderHookRunner } from '../render-hooks.ts';
import { RenderQueue } from '../render-queue.ts';
import { createRenderer, type RenderTools } from '../renderer.ts';
import { createMediaRenderer } from '../posters.ts';
import type { ReplayStore } from '../store.ts';
import type { RenderAssetPolicy } from './browser-network.ts';
import { PosterQueue } from './poster-queue.ts';

/** A positive number from `env[name]`, else `fallback`. */
export function positiveSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** `RENDER_ASSETS` and `RENDER_ASSET_ALLOWLIST`: which outside assets the render browser may load. */
export function renderAssetPolicy(env: NodeJS.ProcessEnv): RenderAssetPolicy {
  const assets = env.RENDER_ASSETS ?? 'public';
  if (assets !== 'public' && assets !== 'origin-only') throw new Error('RENDER_ASSETS must be public or origin-only');
  const allowHosts = (env.RENDER_ASSET_ALLOWLIST ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return { assets, allowHosts };
}

/** Where the render browser loads a replay, and what proves the request comes from it. */
export interface RenderPage {
  assetPolicy: RenderAssetPolicy;
  origin: string;
  token: string;
  tools: RenderTools;
  pageUrl: (id: string) => string;
}

/** The plugins' render hooks as the media queues use them. */
type MediaHooks = Pick<RenderHookRunner, 'posterChooser' | 'checks' | 'beforeRender'>;
type AfterRender = RenderHookRunner['afterRender'] | undefined;

/** Server-side video exports (src/server/renderer.ts), stored with the replay. */
export function createVideoQueue(
  page: RenderPage,
  context: { env: NodeJS.ProcessEnv; store: ReplayStore; afterRender: AfterRender; log: (line: string) => void },
): RenderQueue {
  const { env, store, afterRender, log } = context;
  return new RenderQueue({
    storage: store.storage,
    concurrency: positiveSetting(env, 'RENDER_CONCURRENCY', 1),
    maxQueued: positiveSetting(env, 'RENDER_QUEUE_MAX', 8),
    timeoutMs: positiveSetting(env, 'RENDER_TIMEOUT_MS', 30 * 60_000),
    log,
    ...(afterRender ? { afterRender } : {}),
    runner: createRenderer({
      ...page,
      fps: env.RENDER_FPS === '15' ? 15 : 30,
      onFinish: (stats) =>
        log(
          `render ${stats.id}: ${stats.frames} frames (${stats.captured} captured) for ${(stats.replayMs / 1000).toFixed(1)} s of replay`,
        ),
    }),
  });
}

/**
 * List posters and opening stills (Chromium only) and hover previews (ffmpeg too). The poster's moment is the plugins'
 * `posterAt`, then the profile's `poster` setting (src/shared/profiles.ts), then the default.
 */
export function createPosterQueue(
  page: RenderPage,
  context: { store: ReplayStore; hooks: MediaHooks; afterRender: AfterRender; busy: () => boolean; log: (line: string) => void },
): PosterQueue {
  const { store, hooks, afterRender } = context;
  const media = createMediaRenderer(page);
  const profilePoster = store.profiles.list.some((profile) => profile.poster);
  return new PosterQueue({
    storage: store.storage,
    key: (id, choice) => store.posterKey(id, choice),
    runner: media.poster,
    posterAt: hooks.posterChooser({
      profile: async (id) => (await store.summary(id, { suites: false }))?.profile,
      ...(profilePoster ? { profilePoster: (profile) => store.profiles.poster(profile) } : {}),
      load: (id) => store.load(id),
    }),
    ...(hooks.checks ? { beforeRender: (job: RenderJob) => hooks.beforeRender(job) } : {}),
    ...(afterRender ? { afterRender } : {}),
    thumbhash: (id, hash) => store.setThumbHash(id, hash),
    open: { key: (id: string) => store.openStillKey(id), runner: media.open },
    ...(page.tools.available ? { preview: { key: (id: string) => store.previewKey(id), runner: media.preview } } : {}),
    busy: context.busy,
    log: context.log,
  });
}
