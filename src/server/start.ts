import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';

import type { LoadedConfig } from '../config/index.ts';
import type { ReplaysPlugin } from '../plugin/types.ts';
import { createApp } from './app.ts';
import { coreVersion, findPackageRoot } from './package-info.ts';
import { BridgeHub } from './bridge-hub.ts';
import { createMediaRenderer, PosterQueue } from './posters.ts';
import { RenderQueue } from './render-queue.ts';
import type { RenderService } from './render-routes.ts';
import { createRenderer, detectRenderTools, type RenderTools, renderToken } from './renderer.ts';
import { chooseStorage, createRuntime, type Runtime } from './runtime.ts';
import { tracedStorage } from './storage/traced.ts';
import { initTracing, shutdownTracing } from './tracing.ts';
import { ReplayStore } from './store.ts';

const days = (value: number) => (value > 0 ? `${value} d` : 'never');

const packageRoot = findPackageRoot();

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  /** Where `replays.config.*` is looked for, and relative paths resolve from. Default: the working directory. */
  cwd?: string;
  /** Vite dev middleware (hot reload); needs the repository's sources. */
  dev?: boolean;
  /** Use this config instead of looking one up. */
  config?: LoadedConfig;
  /** Plugins in addition to the config's. */
  plugins?: readonly ReplaysPlugin[];
  /** Overrides PORT / HOST. Port 0 picks a free port. */
  port?: number;
  host?: string;
  /** Read-only sample replays shown next to uploads (`SAMPLE_DIR`). Default: the package's `sample/`. Point it at an empty directory for none. */
  sampleDir?: string;
  /** Close on SIGINT / SIGTERM and exit (what the `replays serve` command does). */
  handleSignals?: boolean;
  log?: (line: string) => void;
}

export interface RunningServer {
  origin: string;
  port: number;
  runtime: Runtime;
  server: Server;
  close(): Promise<void>;
}

async function freePort() {
  const probe = createNetServer();
  await new Promise<void>((done, fail) => {
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', done);
  });
  const { port } = probe.address() as { port: number };
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/**
 * Starts the viewer and API: config + plugins resolved, storage opened, optional render queue and posters, the HTTP(S)
 * listener. Everything `replays serve` does, usable from your own `server.ts`. Rejects with a readable message when
 * configuration is wrong; nothing is listening then.
 */
export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dev = options.dev ?? false;
  const log = options.log ?? ((line: string) => console.log(line));
  const root = packageRoot;

  const runtime = await createRuntime({
    env,
    cwd,
    ...(options.config ? { config: options.config } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });
  const { settings, auth, registry } = runtime;
  const { basePath, branding } = settings;
  if (runtime.config.path) log(`config ${runtime.config.path}`);
  if (registry.order.length) log(`plugins: ${registry.order.join(', ')}`);

  // Tracing (tracing.ts): on only with an OTLP endpoint or OTEL_TRACES_EXPORTER; otherwise the SDK is never loaded.
  try {
    const tracing = await initTracing(env);
    log(String(tracing ?? 'tracing off (no OTEL_EXPORTER_OTLP_ENDPOINT)'));
  } catch (error) {
    throw new Error(`tracing setup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const dataDir = resolve(env.DATA_DIR ?? resolve(root, '.data/replays'));
  const sampleDir = resolve(options.sampleDir ?? (env.SAMPLE_DIR?.trim() || resolve(root, 'sample')));
  // Retention (src/shared/retention.ts) and where data lives (STORAGE=fs|s3|<plugin backend>, src/server/storage/).
  let store: ReplayStore;
  try {
    const storage = tracedStorage(await chooseStorage(env, runtime.config.file, registry, dataDir));
    store = new ReplayStore(storage, sampleDir, settings.retention);
    // The first prune also proves the store is reachable (bucket name, IAM): fail fast instead of serving errors.
    const removed = await store.prune();
    log(
      `storage ${storage.kind} (${storage.description}); retention ${days(store.retention.days)}${removed.length ? `; pruned ${removed.length}` : ''}`,
    );
  } catch (error) {
    throw new Error(`storage or retention setup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const pruneTimer = setInterval(
    () => void store.prune().catch((error: unknown) => console.error('prune failed:', error)),
    6 * 60 * 60_000,
  );
  pruneTimer.unref();

  let devMiddleware: Parameters<typeof createApp>[0]['devMiddleware'];
  let closeDev: (() => Promise<void>) | undefined;
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ root, appType: 'spa', server: { middlewareMode: true } });
    devMiddleware = (request, response, next) => vite.middlewares(request, response, next);
    closeDev = () => vite.close();
  }

  // Server-side video renders (src/server/renderer.ts). Missing Chromium/ffmpeg only switches the feature off.
  const port = options.port === undefined ? Number(env.PORT ?? (dev ? 3000 : 8080)) : options.port === 0 ? await freePort() : options.port;
  const tlsCert = env.TLS_CERT_FILE;
  const tlsKey = env.TLS_KEY_FILE;
  const clientDir = resolve(root, 'dist/client');
  const positive = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
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
      log,
      runner: createRenderer({
        origin,
        token: render.token,
        tools,
        fps: env.RENDER_FPS === '15' ? 15 : 30,
        pageUrl: renderPageUrl,
        onFinish: (stats) =>
          log(
            `render ${stats.id}: ${stats.frames} frames (${stats.captured} captured) for ${(stats.replayMs / 1000).toFixed(1)} s of replay`,
          ),
      }),
    });
    const recovered = await render.queue.recover();
    log(
      `video render on (Chromium ${tools.chromiumPath}, ${tools.ffmpegPath})${recovered ? `; ${recovered} interrupted job(s) marked failed` : ''}`,
    );
  } else {
    log(`video render off: ${tools.reason}`);
  }

  // List posters need only Chromium (no ffmpeg); POSTERS_DISABLED=1 or RENDER_DISABLED=1 turns them off (the index shows placeholders).
  if (tools.chromiumPath && env.POSTERS_DISABLED !== '1') {
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
      log,
    });
    log(`list posters on${tools.available ? ', hover previews on' : ' (hover previews off: no ffmpeg)'}`);
  } else {
    log(`list posters and previews off: ${env.POSTERS_DISABLED === '1' ? 'POSTERS_DISABLED=1' : tools.reason}`);
  }

  const bridgeHub = settings.beta.malleable ? new BridgeHub() : undefined;
  const handle = createApp({
    basePath,
    hosts: settings.hosts,
    auth,
    branding,
    sources: settings.sources,
    beta: settings.beta,
    malleable: settings.malleable,
    versions: { core: coreVersion(), ...(settings.distribution ? { distribution: settings.distribution } : {}) },
    ...(bridgeHub ? { bridgeHub } : {}),
    comments: settings.comments,
    plugins: registry,
    ...(settings.redaction ? { redaction: settings.redaction } : {}),
    ...(settings.contextSchema ? { contextSchema: settings.contextSchema } : {}),
    ...(env.PUBLIC_ORIGIN ? { publicOrigin: env.PUBLIC_ORIGIN.replace(/\/+$/, '') } : {}),
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
  const host = options.host ?? (env.HOST?.trim() || '127.0.0.1');
  if (auth.name === 'none' && !['127.0.0.1', '::1', 'localhost'].includes(host))
    console.warn('WARNING: AUTH_MODE=none on a non-loopback address: anyone who can reach this port can read and upload replays.');
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
  log(`${branding.name} listening on ${host}:${port} (base ${basePath || '/'}, auth ${auth.name}${tlsCert ? ', TLS' : ''})`);
  if (settings.hosts.bases.size)
    log(
      `hosts: ${[...settings.hosts.bases].map(([name, base]) => `${name} at ${base || '/'}`).join(', ')}${settings.hosts.trustForwardedHost ? ' (X-Forwarded-Host trusted)' : ''}`,
    );

  const close = async () => {
    clearInterval(pruneTimer);
    bridgeHub?.close();
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeIdleConnections();
    });
    // Pending spans are flushed before exit (a no-op when tracing is off).
    await Promise.allSettled([closeDev?.(), shutdownTracing()]);
  };
  if (options.handleSignals)
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close().finally(() => process.exit(0)));

  return {
    origin: `${tlsCert && tlsKey ? 'https' : 'http'}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    port,
    runtime,
    server,
    close,
  };
}
