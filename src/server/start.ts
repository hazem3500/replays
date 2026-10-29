import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { access, readFile } from 'node:fs/promises';
import { createServer as createNetServer, type Socket } from 'node:net';
import { resolve } from 'node:path';

import type { ApplicationOptions, ApplicationRuntime } from './agent-native/runtime.ts';
import type { LoadedConfig } from '../config/index.ts';
import type { ReplaysPlugin } from '../plugin/types.ts';
import { createApp } from './app.ts';
import { coreVersion, findPackageRoot } from './package-info.ts';
import { BridgeHub } from './bridge-hub.ts';
import type { RenderAssetPolicy } from './media/browser-network.ts';
import { createMediaRenderer, PosterQueue } from './posters.ts';
import { createRenderHooks } from './render-hooks.ts';
import { RenderQueue } from './render-queue.ts';
import type { RenderService } from './render-routes.ts';
import { createRenderer, detectRenderTools, type RenderTools, renderToken } from './renderer.ts';
import { chooseStorage, createRuntime, type Runtime } from './runtime.ts';
import { tracedStorage } from './storage/traced.ts';
import { initTracing, shutdownTracing, tracingEnabled } from './tracing.ts';
import { ReplayStore } from './store.ts';
import { summaryFieldsRunner } from './summary-fields.ts';

const days = (value: number) => (value > 0 ? `${value} d` : 'never');

const packageRoot = findPackageRoot();

export interface StartOptions {
  /** Main application runtime. Explicit false is for hosts using only the portable HTTP/library API. */
  application?: ApplicationOptions | false;
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

/** Resources acquired by this start attempt, including before the listener is ready. */
interface ServerResources {
  application?: ApplicationRuntime | undefined;
  pruneTimer?: ReturnType<typeof setInterval>;
  server?: Server;
  closeDev?: () => Promise<void>;
  render?: RenderService;
  bridgeHub?: BridgeHub | undefined;
  ownsTracing?: boolean;
  sockets: Set<Socket>;
}

/**
 * Starts the viewer and API: config + plugins resolved, storage opened, optional render queue and posters, the HTTP(S)
 * listener. Everything `replays serve` does, usable from your own `server.ts`. Rejects with a readable message when
 * configuration is wrong; nothing is listening then.
 */
export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const resources: ServerResources = { sockets: new Set() };
  let closing: Promise<void> | undefined;
  let failed = false;
  const close = () => {
    closing ??= (async () => {
      const errors: unknown[] = [];
      const release = async (fn: () => unknown) => {
        try {
          await fn();
        } catch (error) {
          errors.push(error);
        }
      };
      clearInterval(resources.pruneTimer);
      await release(() => resources.bridgeHub?.close());
      await release(() => resources.render?.queue?.close());
      const connectionsClosed = release(async () => {
        const server = resources.server;
        if (!server) return;
        await new Promise<void>((done) => {
          // A server that failed to listen reports ERR_SERVER_NOT_RUNNING here; no listener needs releasing.
          server.close(() => done());
          server.closeIdleConnections();
          // A late startup failure may already have accepted connections, including HMR upgrades.
          if (failed) for (const socket of resources.sockets) socket.destroy();
        });
      });
      await release(() => resources.application?.close());
      await connectionsClosed;
      // Run every finalizer, including when another finalizer throws synchronously.
      await Promise.all([release(() => resources.closeDev?.()), release(() => (resources.ownsTracing ? shutdownTracing() : undefined))]);
      if (errors.length) throw new AggregateError(errors, 'server shutdown cleanup failed');
    })();
    return closing;
  };
  try {
    return await startOwnedServer(options, resources, close);
  } catch (error) {
    failed = true;
    // The caller has no handle on failure. Await all releases and preserve the original startup error.
    await close().catch(() => undefined);
    throw error;
  }
}

async function startOwnedServer(options: StartOptions, resources: ServerResources, close: () => Promise<void>): Promise<RunningServer> {
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
    const alreadyTracing = tracingEnabled();
    const tracing = await initTracing(env);
    resources.ownsTracing = !alreadyTracing && tracingEnabled();
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
    const summaryFields = summaryFieldsRunner(registry.summaryFields);
    store = new ReplayStore(storage, sampleDir, settings.retention, {
      profiles: settings.profiles,
      ...(summaryFields ? { summaryFields } : {}),
    });
    // The first prune also proves the store is reachable (bucket name, IAM): fail fast instead of serving errors.
    const removed = await store.prune();
    log(
      `storage ${storage.kind} (${storage.description}); retention ${days(store.retention.days)}${removed.length ? `; pruned ${removed.length}` : ''}`,
    );
    if (store.profiles.size)
      log(
        `profiles: ${store.profiles.list
          .map((profile) => `${profile.id}${profile.retentionDays === undefined ? '' : ` (${days(profile.retentionDays)})`}`)
          .join(', ')}`,
      );
  } catch (error) {
    throw new Error(`storage or retention setup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const application = (resources.application =
    options.application === false
      ? undefined
      : await (
          await import('./agent-native/runtime.ts')
        ).createApplicationRuntime(store, auth.name, {
          ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
          ...(env.REPLAYS_WORKSPACE_ID ? { workspaceId: env.REPLAYS_WORKSPACE_ID } : {}),
          credentials: env.REPLAYS_AGENT_CREDENTIALS === '1',
          ...options.application,
        }));

  const pruneTimer = (resources.pruneTimer = setInterval(
    () => void store.prune().catch((error: unknown) => console.error('prune failed:', error)),
    6 * 60 * 60_000,
  ));
  pruneTimer.unref();

  const tlsCert = env.TLS_CERT_FILE;
  const tlsKey = env.TLS_KEY_FILE;
  const server = (resources.server =
    tlsCert && tlsKey ? createHttpsServer({ cert: await readFile(tlsCert), key: await readFile(tlsKey) }) : createHttpServer());
  server.on('connection', (socket) => {
    resources.sockets.add(socket);
    socket.once('close', () => resources.sockets.delete(socket));
  });

  let devMiddleware: Parameters<typeof createApp>[0]['devMiddleware'];
  let devIndexHtml: Parameters<typeof createApp>[0]['devIndexHtml'];
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    // Share the public listener so reverse proxies need only forward the app port, including WebSockets.
    const vite = await createViteServer({ root, appType: 'spa', server: { middlewareMode: true, hmr: { server } } });
    devMiddleware = (request, response, next) => vite.middlewares(request, response, next);
    // Queries must not make Vite parse inline styles as script modules.
    devIndexHtml = async (url) =>
      vite.transformIndexHtml(new URL(url, 'http://dev.invalid').pathname, await readFile(resolve(root, 'index.html'), 'utf8'));
    resources.closeDev = () => vite.close();
  }

  // Server-side video renders (src/server/renderer.ts). Missing Chromium/ffmpeg only switches the feature off.
  const port = options.port === undefined ? Number(env.PORT ?? (dev ? 3000 : 8080)) : options.port === 0 ? await freePort() : options.port;
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
  const render: RenderService = (resources.render = {
    tools,
    token: renderToken(),
    clientDir,
    maxDurationMs: positive('RENDER_MAX_DURATION_MS', 10 * 60_000),
  });
  const origin = `${tlsCert && tlsKey ? 'https' : 'http'}://127.0.0.1:${port}`;
  // Dev serves the render page through Vite; production serves the built page on the loopback-only route.
  const assets = env.RENDER_ASSETS ?? 'public';
  if (assets !== 'public' && assets !== 'origin-only') throw new Error('RENDER_ASSETS must be public or origin-only');
  const assetPolicy: RenderAssetPolicy = {
    assets,
    allowHosts: (env.RENDER_ASSET_ALLOWLIST ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  };
  const renderPageUrl = (id: string) => (dev ? `${origin}${basePath}/render.html?id=${id}` : `${origin}/internal/render/${id}`);
  // `api.render`: the poster's moment, the check before each list-media job, and the call after each stored file.
  // (createApp runs `beforeRender` for video exports, on the request.)
  const renderHooks = createRenderHooks(registry.render, (line) => console.error(line));
  const afterRender = renderHooks.notifies ? renderHooks.afterRender : undefined;
  if (tools.available) {
    render.queue = new RenderQueue({
      storage: store.storage,
      concurrency: positive('RENDER_CONCURRENCY', 1),
      maxQueued: positive('RENDER_QUEUE_MAX', 8),
      timeoutMs: positive('RENDER_TIMEOUT_MS', 30 * 60_000),
      log,
      ...(afterRender ? { afterRender } : {}),
      runner: createRenderer({
        assetPolicy,
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
    const media = createMediaRenderer({ assetPolicy, origin, token: render.token, tools, pageUrl: renderPageUrl });
    render.posters = new PosterQueue({
      storage: store.storage,
      key: (id, choice) => store.posterKey(id, choice),
      runner: media.poster,
      // The plugins' `posterAt`, then the profile's `poster` setting (src/shared/profiles.ts), then the default.
      posterAt: renderHooks.posterChooser({
        profile: async (id) => (await store.summary(id, { suites: false }))?.profile,
        ...(store.profiles.list.some((profile) => profile.poster) ? { profilePoster: (profile) => store.profiles.poster(profile) } : {}),
        load: (id) => store.load(id),
      }),
      ...(renderHooks.checks ? { beforeRender: renderHooks.beforeRender } : {}),
      ...(afterRender ? { afterRender } : {}),
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

  const bridgeHub = (resources.bridgeHub = settings.beta.malleable ? new BridgeHub() : undefined);
  const pages = dev ? undefined : await startPages(root, env, (request, response) => handle(request, response), log);
  const handle = createApp({
    ...(pages ? { pages } : {}),
    ...(application ? { application } : {}),
    basePath,
    hosts: settings.hosts,
    auth,
    ...(settings.signIn !== undefined ? { signIn: settings.signIn } : {}),
    branding,
    sources: settings.sources,
    views: settings.views,
    beta: settings.beta,
    malleable: settings.malleable,
    versions: { core: coreVersion(), ...(settings.distribution ? { distribution: settings.distribution } : {}) },
    editing: settings.editing,
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
    ...(devIndexHtml ? { devIndexHtml } : {}),
  });

  server.on('request', (request, response) => void handle(request, response));
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

/**
 * Pages rendered by TanStack Start (src/server/pages/start.ts) when the Start build is there (`REPLAYS_SSR=0` opts out); else
 * the stamped index.html, as before. A Start bundle that fails to load is logged and the server stays up on the SPA page.
 */
async function startPages(
  root: string,
  env: NodeJS.ProcessEnv,
  api: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  log: (message: string) => void,
) {
  if (/^(0|false|off)$/i.test(env.REPLAYS_SSR ?? '')) return undefined;
  const entry = resolve(root, 'dist/start/server/server.js');
  if (
    !(await access(entry).then(
      () => true,
      () => false,
    ))
  ) {
    log('server-rendered pages off: no Start build (dist/start); serving the single-page app');
    return undefined;
  }
  try {
    const { loadStartRenderer } = await import('./pages/start.ts');
    const renderer = await loadStartRenderer(entry, api);
    log('pages rendered on the server (TanStack Start)');
    return { renderer, clientDir: resolve(root, 'dist/start/client') };
  } catch (error) {
    log(`server-rendered pages off (${String(error)}); serving the single-page app`);
    return undefined;
  }
}
