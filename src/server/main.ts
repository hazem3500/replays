import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createApp } from './app.ts';
import { authFromEnv } from './auth/index.ts';
import { loadSettings, readConfigFile } from './config.ts';
import { createMediaRenderer, PosterQueue } from './posters.ts';
import { RenderQueue } from './render-queue.ts';
import type { RenderService } from './render-routes.ts';
import { createRenderer, detectRenderTools, type RenderTools, renderToken } from './renderer.ts';
import { storageFromEnv } from './storage/index.ts';
import { tracedStorage } from './storage/traced.ts';
import { initTracing, shutdownTracing } from './tracing.ts';
import { ReplayStore } from './store.ts';

const dev = process.argv.includes('--dev');
const root = resolve(import.meta.dirname, '../..');

let settings: Awaited<ReturnType<typeof loadSettings>>;
let auth: Awaited<ReturnType<typeof authFromEnv>>;
try {
  settings = await loadSettings(process.env, await readConfigFile(process.env.REPLAYS_CONFIG));
  auth = await authFromEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { basePath, branding } = settings;

// Tracing (tracing.ts): on only with an OTLP endpoint or OTEL_TRACES_EXPORTER; otherwise the SDK is never loaded.
try {
  const tracing = await initTracing(process.env);
  console.log(tracing ?? 'tracing off (no OTEL_EXPORTER_OTLP_ENDPOINT)');
} catch (error) {
  console.error(`tracing setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, '.data/replays'));
const sampleDir = resolve(root, 'sample');
// Retention (src/shared/retention.ts) and where data lives (STORAGE=fs|s3, src/server/storage/).
const days = (value: number) => (value > 0 ? `${value} d` : 'never');
let store: ReplayStore;
try {
  const storage = tracedStorage(await storageFromEnv(process.env, dataDir));
  store = new ReplayStore(storage, sampleDir, settings.retention);
  // The first prune also proves the store is reachable (bucket name, IAM): fail fast instead of serving errors.
  const removed = await store.prune();
  console.log(
    `storage ${storage.kind} (${storage.description}); retention ${days(store.retention.days)}${removed.length ? `; pruned ${removed.length}` : ''}`,
  );
} catch (error) {
  console.error(`storage or retention setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
setInterval(() => void store.prune().catch((error: unknown) => console.error('prune failed:', error)), 6 * 60 * 60_000).unref();

let devMiddleware: Parameters<typeof createApp>[0]['devMiddleware'];
let closeDev: (() => Promise<void>) | undefined;
if (dev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, appType: 'spa', server: { middlewareMode: true } });
  devMiddleware = (request, response, next) => vite.middlewares(request, response, next);
  closeDev = () => vite.close();
}

// Server-side video renders (src/server/renderer.ts). Missing Chromium/ffmpeg only switches the feature off.
const port = Number(process.env.PORT ?? (dev ? 3000 : 8080));
const tlsCert = process.env.TLS_CERT_FILE;
const tlsKey = process.env.TLS_KEY_FILE;
const clientDir = resolve(root, 'dist/client');
const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const tools: RenderTools = await detectRenderTools().catch((error: unknown) => ({
  available: false,
  reason: String(error),
  ffmpegPath: 'ffmpeg',
}));
const render: RenderService = { tools, token: renderToken(), clientDir, maxDurationMs: positive('RENDER_MAX_DURATION_MS', 10 * 60_000) };
const origin = `${tlsCert && tlsKey ? 'https' : 'http'}://127.0.0.1:${port}`;
// Dev serves the render page through Vite; production serves the built page on the loopback-only route.
const renderPageUrl = (id: string) => (dev ? `${origin}${basePath}/render.html?id=${id}` : `${origin}/internal/render/${id}`);
if (tools.available) {
  render.queue = new RenderQueue({
    storage: store.storage,
    concurrency: positive('RENDER_CONCURRENCY', 1),
    maxQueued: positive('RENDER_QUEUE_MAX', 8),
    timeoutMs: positive('RENDER_TIMEOUT_MS', 30 * 60_000),
    log: (line) => console.log(line),
    runner: createRenderer({
      origin,
      token: render.token,
      tools,
      fps: process.env.RENDER_FPS === '15' ? 15 : 30,
      pageUrl: renderPageUrl,
      onFinish: (stats) =>
        console.log(
          `render ${stats.id}: ${stats.frames} frames (${stats.captured} captured) for ${(stats.replayMs / 1000).toFixed(1)} s of replay`,
        ),
    }),
  });
  const recovered = await render.queue.recover();
  console.log(
    `video render on (Chromium ${tools.chromiumPath}, ${tools.ffmpegPath})${recovered ? `; ${recovered} interrupted job(s) marked failed` : ''}`,
  );
} else {
  console.log(`video render off: ${tools.reason}`);
}

// List posters need only Chromium (no ffmpeg); POSTERS_DISABLED=1 or RENDER_DISABLED=1 turns them off (the index shows placeholders).
if (tools.chromiumPath && process.env.POSTERS_DISABLED !== '1') {
  const media = createMediaRenderer({ origin, token: render.token, tools, pageUrl: renderPageUrl });
  render.posters = new PosterQueue({
    storage: store.storage,
    key: (id) => store.posterKey(id),
    runner: media.poster,
    open: { key: (id: string) => store.openStillKey(id), runner: media.open },
    // Hover previews are MP4s: they need ffmpeg too.
    ...(tools.available ? { preview: { key: (id: string) => store.previewKey(id), runner: media.preview } } : {}),
    // List media are low priority: they wait while a video export is rendering.
    busy: () => (render.queue?.size.running ?? 0) > 0,
    log: (line) => console.log(line),
  });
  console.log(`list posters on${tools.available ? ', hover previews on' : ' (hover previews off: no ffmpeg)'}`);
} else {
  console.log(`list posters and previews off: ${process.env.POSTERS_DISABLED === '1' ? 'POSTERS_DISABLED=1' : tools.reason}`);
}

const handle = createApp({
  basePath,
  auth,
  branding,
  sources: settings.sources,
  beta: settings.beta,
  ...(settings.contextSchema ? { contextSchema: settings.contextSchema } : {}),
  ...(process.env.PUBLIC_ORIGIN ? { publicOrigin: process.env.PUBLIC_ORIGIN.replace(/\/+$/, '') } : {}),
  store,
  clientDir,
  render,
  ...(devMiddleware ? { devMiddleware } : {}),
});

const server =
  tlsCert && tlsKey
    ? createHttpsServer(
        { cert: await readFile(tlsCert), key: await readFile(tlsKey) },
        (request, response) => void handle(request, response),
      )
    : createHttpServer((request, response) => void handle(request, response));
// Loopback by default: a deployment that wants the network says so with HOST=0.0.0.0 (the Docker image does).
const host = process.env.HOST?.trim() || '127.0.0.1';
if (auth.name === 'none' && !['127.0.0.1', '::1', 'localhost'].includes(host))
  console.warn('WARNING: AUTH_MODE=none on a non-loopback address: anyone who can reach this port can read and upload replays.');
server.listen(port, host, () => {
  console.log(`${branding.name} listening on ${host}:${port} (base ${basePath || '/'}, auth ${auth.name}${tlsCert ? ', TLS' : ''})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Pending spans are flushed before exit (a no-op when tracing is off).
    server.close(
      () =>
        void Promise.allSettled([closeDev?.(), shutdownTracing()]).finally(() => {
          process.exit(0);
        }),
    );
  });
}
