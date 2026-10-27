import { StoredDataError } from './storage/types.ts';
import { HttpError } from '../shared/http-error.ts';
import { confineToEndpoint, routeAllowed, uploadEndpointAt } from './api/upload-endpoints.ts';
import { applyRequestPolicy } from './request-policy.ts';
import { normalizeSignIn, signInReturn, type SignInConfig } from '../shared/sign-in.ts';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';

import { sanitizeReplayBundle } from '../capture/sanitize.ts';
import { mergeRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import { type ReplayBundle } from '../shared/replay.ts';
import { defaultPolicy, type MalleablePolicy, type HostVersions } from '../shared/malleable-policy.ts';
import { EMPTY_REGISTRY, mergeRegistries, resolvePluginsSync, type PluginRegistry } from '../plugin/registry.ts';
import type { Identity, AuthAdapter } from './auth/types.ts';
import { COMPRESSIBLE, CompressionCache, compress, pickEncoding } from './compression.ts';
import { appPath, type HostRouting, hostBase, hostVary, normalizeHosts, publicPath, type HostConfig } from './base-path.ts';
import { renderIndexHtml } from './index-page.ts';
import { coreRoutes } from './api/index.ts';
import { authenticatedPluginRoutes, publicPluginRoutes, runWebMiddleware } from './api/plugin-routes.ts';
import { sendWebResponse, toWebRequest } from './http/node.ts';
import { classifyError } from './http/errors.ts';
import { RouteTable } from './http/route.ts';
import { BridgeHub } from './bridge-hub.ts';
import { commentsPlugin, COMMENTS_PLUGIN } from './comments-plugin.ts';
import { malleablePlugin } from './malleable-plugin.ts';
import { coreVersion } from './package-info.ts';
import { editingFromEnv, type EditingSettings } from './editing-config.ts';
import { handleEditsApi } from './edits-routes.ts';
import { handleKeepApi } from './keep-routes.ts';
import { handlePosterApi } from './posters.ts';
import { identityResolver } from './people.ts';
import { clientAsset, runRequestHooks, watchResponse } from './plugin-runtime.ts';
import { createRenderHooks } from './render-hooks.ts';
import { handleInternalRender, handleRenderApi, type RenderService } from './render-routes.ts';
import { serveObject } from './serve-object.ts';
import { type ReplayStore } from './store.ts';
import { recordError, setRequestAttributes, traceRequest, withSpan } from './tracing.ts';
import type { ApplicationRuntime } from './agent-native/runtime.ts';
import type { BrandingConfig } from './branding.ts';
import type { SourceProviders } from '../shared/source-providers.ts';
import type { ContextSchema } from './context-schema.ts';
import type { BetaFlags } from './beta.ts';
import type { CommentsSettings } from './comments-config.ts';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface AppOptions {
  /** Main application dispatcher, behind host auth and request policy. */
  application?: ApplicationRuntime;
  signIn?: SignInConfig | false;
  auth: AuthAdapter;
  store: ReplayStore;
  clientDir: string;
  branding: BrandingConfig;
  /** Resolves `context.sources` references into links; defaults to the built-in providers. */
  sources: SourceProviders;
  /** Optional JSON Schema for `context.fields` (context-schema.ts). */
  contextSchema?: ContextSchema;
  devMiddleware?: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  /** Vite-transformed dev HTML, rendered through the shared server metadata contract. */
  devIndexHtml?: (url: string) => Promise<string>;
  /** Server-side video renders; absent means every render route answers 503. */
  render?: RenderService;
  /** Where the app lives publicly (base-path.ts): `''` at the root of its own domain, else e.g. `/replays`. */
  basePath?: string;
  /**
   * A different base per request host (base-path.ts): `{ 'replays.example.com': { basePath: '' } }`, or the checked
   * form `loadSettings` returns. Hosts not listed get `basePath`. With any entry, every response says `Vary: Host`.
   */
  hosts?: Readonly<Record<string, HostConfig>> | HostRouting;
  /** Pick the request host from `X-Forwarded-Host` instead of `Host` (a gateway that rewrites `Host`); with a raw `hosts`. */
  trustForwardedHost?: boolean;
  /** Beta features, all off by default (`REPLAYS_BETA_EDITOR=true` / `beta.editor`): see src/server/config.ts. */
  beta?: BetaFlags;
  /** Host write policy; defaults to enabled within beta.editor. Saved edits remain readable and applied when disabled. */
  editing?: EditingSettings;
  /** The agent bridge's relay (beta.malleable); the server closes it on shutdown so open streams do not hold it up. */
  bridgeHub?: BridgeHub;
  /** The host's policy for user plugins (`malleable` in the config, src/shared/malleable-policy.ts); default: `defaultPolicy()`. */
  malleable?: MalleablePolicy;
  /** The core package version and the configured `distribution`; default: this package's version, no distribution. */
  versions?: HostVersions;
  /** Comments on replays (`REPLAYS_COMMENTS`, on by default in the server's settings): absent here means off. */
  comments?: CommentsSettings;
  /** Public origin (`https://replays.example.com`); only auth adapters that redirect need it. */
  publicOrigin?: string;
  /** What the loaded plugins registered (src/plugin/registry.ts); none by default. */
  plugins?: PluginRegistry;
  /** Redaction rules from the config file; the plugins' `api.redaction` rules are added to them. */
  redaction?: RedactionRules;
}

/**
 * Default caching for dynamic responses: `private` (an auth layer sits in front, so shared caches must never keep
 * them) and `no-cache` (the browser revalidates every time). Not `no-store`: a page whose own document or
 * whose fetches answered `no-store` is kept out of the back/forward cache, so Back would reload the replay.
 */
export const REVALIDATE = 'private, no-cache';
/** Uploaded replay bundles never change (save() refuses an existing id), so they are cached for a day. */
export const IMMUTABLE_PRIVATE = 'private, max-age=86400, immutable';

export function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  cacheControl = REVALIDATE,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { ...headers, 'content-type': contentType, 'cache-control': cacheControl });
  response.end(body);
}

/** A validator for a generated body: weak, because the same entity goes out br, gzip or identity-encoded. */
export function bodyEtag(body: Buffer | string) {
  return `W/"${createHash('sha1').update(body).digest('base64url')}"`;
}

/**
 * Like send(), but gzip/brotli-encodes larger bodies when the client accepts it, and tags 200s with an
 * ETag so a revalidation (`no-cache`) costs a 304 instead of the body.
 */
async function sendCompressed(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  /** Extra `Vary` (e.g. `Host` for a page that differs by host); the 304 carries it too. */
  vary?: string,
) {
  const buffer = Buffer.from(body);
  const etag = status === 200 ? bodyEtag(buffer) : undefined;
  // A `Vary` already on the response (`Host` with per-host bases, createApp) is kept.
  const varies = ['Accept-Encoding', response.getHeader('vary'), vary].filter((value) => typeof value === 'string' && value).join(', ');
  const common = { 'cache-control': REVALIDATE, vary: varies, ...(etag ? { etag } : {}) };
  if (etag && notModified(request, etag)) {
    response.writeHead(304, common);
    response.end();
    return;
  }
  const encoding =
    buffer.byteLength >= 1024 && COMPRESSIBLE.test(contentType) ? pickEncoding(request.headers['accept-encoding']) : undefined;
  const payload = encoding ? await compress(buffer, encoding) : buffer;
  response.writeHead(status, {
    ...common,
    'content-type': contentType,
    'content-length': String(payload.byteLength),
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : payload);
}

/** True when If-None-Match (weak comparison) matches `etag`. */
export function notModified(request: IncomingMessage, etag: string) {
  const header = request.headers['if-none-match'];
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === bare);
}

function parseReplayPath(path: string) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})(\/video)?$/.exec(path);
  return match ? { id: match[1]!, video: Boolean(match[2]) } : undefined;
}

const compressionCache = new CompressionCache();

/**
 * Streams a file, or serves a cached gzip/brotli copy for compressible types.
 * `etag` enables If-None-Match revalidation.
 */
export async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  cacheControl: string,
  options: { contentType?: string; etag?: boolean; headers?: Record<string, string>; ranges?: boolean } = {},
) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return false;
  const contentType = options.contentType ?? MIME[extname(path)] ?? 'application/octet-stream';
  const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = { ...options.headers, 'content-type': contentType, 'cache-control': cacheControl };
  if (options.etag) headers.etag = etag;
  if (options.etag && notModified(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  // Single byte ranges for media (<video> needs them in Safari); multi-range requests get the whole file.
  if (options.ranges) {
    headers['accept-ranges'] = 'bytes';
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? '').trim());
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
        response.end();
        return true;
      }
      response.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': String(end - start + 1),
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path, { start, end }).pipe(response);
      return true;
    }
  }
  const encoding = COMPRESSIBLE.test(contentType) && info.size >= 1024 ? pickEncoding(request.headers['accept-encoding']) : undefined;
  if (COMPRESSIBLE.test(contentType)) headers.vary = 'Accept-Encoding';
  if (encoding) {
    const payload = await compressionCache.get(`${path}|${etag}`, encoding, () => readFile(path));
    response.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': String(payload.byteLength) });
    response.end(request.method === 'HEAD' ? undefined : payload);
    return true;
  }
  response.writeHead(200, { ...headers, 'content-length': String(info.size) });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
  return true;
}

/** Browsers send `Sec-Fetch-Site`; a state-changing request from another site is refused. CLI clients send none. */
export function sameOrigin(request: IncomingMessage) {
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

/** A top-level page load from a browser, as opposed to a health check or API client. */
export function isBrowserNavigation(request: IncomingMessage) {
  if (request.headers['sec-fetch-mode'] === 'navigate') return true;
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html');
}

/** `x-replay-purpose: <id>; inferred` for a replay whose purpose was inferred (explicit ones are in the bundle). */
async function servedPurpose(store: ReplayStore, id: string): Promise<Record<string, string> | undefined> {
  const summary = await store.summary(id, { suites: false }).catch(() => undefined);
  return summary?.purpose && summary.purposeInferred ? { 'x-replay-purpose': `${summary.purpose}; inferred` } : undefined;
}

/** `AppOptions.hosts` as routing: already checked (`loadSettings`), or a plain record checked here. */
function hostRouting(options: AppOptions): HostRouting | undefined {
  const hosts = options.hosts;
  if (!hosts) return undefined;
  if ('bases' in hosts && hosts.bases instanceof Map) return hosts as HostRouting;
  return normalizeHosts(hosts, options.trustForwardedHost ?? false);
}

/** A browser recovery may only return to a page, never another auth or machine endpoint. */
function signInDestination(next: string | null, base: string, path: string) {
  const destination = signInReturn(next, publicPath('/', base));
  const target = new URL(destination, 'http://replays.invalid');
  const targetPath = base && target.pathname.startsWith(`${base}/`) ? target.pathname.slice(base.length) : target.pathname;
  const blocked = target.pathname === publicPath(path, base) || /^\/(api|auth|internal|_plugins)(\/|$)/.test(targetPath);
  return blocked ? publicPath('/', base) : destination;
}

export function createApp(options: AppOptions) {
  const defaultBase = options.basePath ?? '';
  const signIn = normalizeSignIn(options.signIn ?? options.auth.signIn);
  const routing = hostRouting(options);
  // With per-host bases the same path is a different route from one host to the next, so every response varies by it.
  const vary = hostVary(routing);
  const editing = { enabled: editingFromEnv({}, options.editing).enabled && Boolean(options.beta?.editor) };
  // Comments are a built-in plugin, loaded first when enabled (comments-plugin.ts); `commentsOn` is "that plugin is loaded".
  const userPlugins = options.plugins ?? EMPTY_REGISTRY;
  const anonymous = options.auth.name === 'none';
  const policy = options.malleable ?? defaultPolicy();
  const versions = options.versions ?? { core: coreVersion() };
  const builtIns = [
    ...(options.comments?.enabled ? [commentsPlugin({ store: options.store, anonymous })] : []),
    // Beta: user plugins and the agent bridge. Absent unless the flag is on: no routes, no sandbox page, no bridge.
    ...(options.beta?.malleable
      ? [malleablePlugin({ storage: options.store.storage, anonymous, hub: options.bridgeHub ?? new BridgeHub(), policy, versions })]
      : []),
  ];
  const registry = builtIns.length ? mergeRegistries(resolvePluginsSync(builtIns), userPlugins) : userPlugins;
  const commentsOn = registry.order.includes(COMMENTS_PLUGIN);
  // `api.render`'s `beforeRender` for video exports (the queues in start.ts run the rest of the render hooks).
  const renderHooks = createRenderHooks(registry.render);
  const beforeRender = renderHooks.checks ? renderHooks.beforeRender : undefined;
  const purposes = options.store.purposes;
  const inferable = purposes.list.some((purpose) => purpose.inferable);
  const redaction = mergeRedactionRules(options.redaction, registry.redaction);
  /** The server's privacy pass over an upload, in its own span (it walks every event): the defaults plus the host's rules. */
  const sanitize = (bundle: ReplayBundle) =>
    withSpan('replay.sanitize', { 'replay.event_count': bundle.events.length }, () => sanitizeReplayBundle(bundle, redaction));
  const answerPublicRoute = publicPluginRoutes(registry);
  const routes = new RouteTable([
    ...coreRoutes({
      deployment: {
        store: options.store,
        auth: options.auth,
        sources: options.sources,
        branding: options.branding,
        contextSchema: options.contextSchema,
        beta: options.beta,
        publicOrigin: options.publicOrigin,
        posters: options.render?.posters,
      },
      registry,
      redaction,
      sanitize,
      signIn,
      editing,
      commentsOn,
      policy,
      versions,
      inferable,
    }),
    ...authenticatedPluginRoutes(registry),
  ]);
  /** index.html as served at `base` (index-page.ts, shared with `replays build-static`). */
  const indexPage = (html: string, base: string) =>
    renderIndexHtml(html, {
      base,
      branding: options.branding,
      purposes: purposes.list,
      sources: options.sources.describe(),
      ...(signIn ? { signIn } : {}),
      ...(options.beta ? { beta: options.beta } : {}),
      comments: commentsOn,
      editing,
      clientEntries: registry.clientEntries,
    });
  /** The signed-in person per request, for the `onResponse` hooks. */
  const identities = new WeakMap<IncomingMessage, Identity>();
  const resolveIdentity = identityResolver(registry);

  const json = 'application/json; charset=utf-8';

  /** Everything past the health checks, inside the request's span. */
  async function serve(request: IncomingMessage, response: ServerResponse, raw: URL, path: string, base: string) {
    const routeContext = { base, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) };
    let web: Request | undefined;
    const webRequest = () => (web ??= toWebRequest(request, response));
    const answer = async (page: Response | undefined) => {
      if (page) await sendWebResponse(response, page, request.method);
      return Boolean(page);
    };
    try {
      // Loopback + per-process token only (render-routes.ts); never reachable through the public path.
      if (path.startsWith('/internal/render/')) {
        await handleInternalRender(request, response, path, options);
        return;
      }

      const requestPolicy = applyRequestPolicy(registry, request, response, path);
      if (requestPolicy.handled) return;

      if (registry.hooks.preAuth.length && (await runRequestHooks(registry, 'pre-auth', { request, response, path }))) return;
      if (
        registry.hooks.webPreAuth.length &&
        (await answer(await runWebMiddleware(registry, 'pre-auth', { request: webRequest(), url: raw, path, base })))
      )
        return;

      // The adapter's own routes (sign-in, callback) come first: they run without an identity.
      if (options.auth.handle && options.auth.routes?.includes(path) && (await options.auth.handle(request, response, routeContext)))
        return;

      if (
        registry.routes.length &&
        (await answer(
          await answerPublicRoute({ request: webRequest(), url: raw, path, base, crossSiteAllowed: requestPolicy.csrfAllowed }),
        ))
      )
        return;

      // Public, credential-free CLI auth contract. It is separate from the normal viewer config and works before sign-in.
      if (path === '/api/cli/auth/capabilities' && request.method === 'GET') {
        let capability;
        try {
          capability = await options.auth.cliDeviceAuth?.(routeContext);
        } catch {
          capability = undefined;
        }
        send(response, 200, JSON.stringify({ auth: options.auth.name, deviceFlow: capability ?? null }), json, 'no-store');
        return;
      }

      // invariant: an endpoint's own credentials replace the deployment adapter on its path only, and confine the identity to it.
      const endpointAuth = uploadEndpointAt(registry, path)?.authenticate;
      const authenticated: Identity | undefined = endpointAuth ? await endpointAuth(request) : await options.auth.authenticate(request);
      if (!authenticated && endpointAuth) {
        send(response, 401, 'credentials required', 'text/plain; charset=utf-8', 'no-store');
        return;
      }
      if (!authenticated) {
        const recovery = signIn && path === signIn.path && request.method === 'GET' && isBrowserNavigation(request);
        // loginUrl adapters (including OIDC) return to this authenticated endpoint after their callback.
        // Keep the original page inside a normalized next parameter without mutating the real request.
        const loginRequest = recovery
          ? Object.assign(Object.create(request) as IncomingMessage, {
              url: `${publicPath(signIn.path, base)}?${new URLSearchParams({ next: signInDestination(raw.searchParams.get('next'), base, signIn.path) })}`,
            })
          : request;
        const login = options.auth.loginUrl?.(loginRequest, routeContext);
        if (login && request.method === 'GET' && isBrowserNavigation(request) && (recovery || !path.startsWith('/api/'))) {
          response.writeHead(302, { location: login, 'cache-control': 'no-store' });
          response.end();
          return;
        }
        send(response, login ? 401 : 403, login ? 'sign in required' : 'forbidden');
        return;
      }
      // Identity resolvers (api.identity) may add a name and avatar; never another id.
      const user = await resolveIdentity(endpointAuth ? confineToEndpoint(authenticated, path) : authenticated, { request, webRequest: webRequest() });
      identities.set(request, user);
      const denied = routeAllowed(registry, user, request.method ?? 'GET', path);
      if (denied) {
        send(response, 403, denied);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET') && !sameOrigin(request) && !requestPolicy.csrfAllowed) {
        send(response, 403, 'cross-site request');
        return;
      }
      await options.application?.authorize(request, path, user);
      if (registry.hooks.postAuth.length && (await runRequestHooks(registry, 'post-auth', { request, response, path, identity: user })))
        return;
      if (
        registry.hooks.webPostAuth.length &&
        (await answer(await runWebMiddleware(registry, 'post-auth', { request: webRequest(), url: raw, path, base, identity: user })))
      )
        return;
      if (signIn && path === signIn.path) {
        if (request.method !== 'GET') {
          send(response, 405, JSON.stringify({ error: 'method not allowed' }), json);
          return;
        }
        response.writeHead(302, {
          location: signInDestination(raw.searchParams.get('next'), base, signIn.path),
          'cache-control': 'no-store',
          ...(vary ? { vary } : {}),
        });
        response.end();
        return;
      }
      const route = request.method ? routes.match(request.method, path) : undefined;
      if (route) {
        const page = await route.route.handler({
          request: webRequest(),
          url: raw,
          path,
          params: route.params,
          base,
          identity: user,
          trace: (attributes) => setRequestAttributes(request, attributes),
          crossSiteAllowed: requestPolicy.csrfAllowed,
          hooks: { request, webRequest: webRequest() },
        });
        await sendWebResponse(response, page, request.method);
        return;
      }
      if (await options.application?.handle(request, response, path, user)) return;
      // Files of the plugins' client entries (behind the same auth as everything else).
      const asset = request.method === 'GET' || request.method === 'HEAD' ? clientAsset(registry, path) : undefined;
      if (asset) {
        if (!(await serveFile(request, response, asset.file, REVALIDATE, { contentType: asset.contentType, etag: true })))
          send(response, 404, 'not found');
        return;
      }
      if (await handleRenderApi(request, response, path, raw.searchParams, { ...options, beforeRender, identity: user })) return;
      if (await handlePosterApi(request, response, path, { store: options.store, posters: options.render?.posters })) return;
      if (await handleKeepApi(request, response, path, { store: options.store, user: user.id })) return;
      // Beta: the editor's edit lists. Off by default: the path then falls through to the generic API 404.
      if (options.beta?.editor && (await handleEditsApi(request, response, path, { store: options.store, user: user.id, editing }))) return;

      const replayPath = parseReplayPath(path);
      if (replayPath && request.method === 'GET' && !replayPath.video) {
        // Bundles are validated on save (samples are committed), so the stored
        // file is served as-is: no parse/stringify, cached compression. Uploads are immutable, so the
        // browser keeps them for a day without asking again (reopening a replay reads its disk cache);
        // committed samples can change with a deploy, so they revalidate (ETag).
        const located = await options.store.locate(replayPath.id);
        // An inferred purpose is not in the bundle: the viewer reads it from this header to open the replay its way.
        const purposeHeaders = located && inferable ? await servedPurpose(options.store, replayPath.id) : undefined;
        if (
          !located ||
          !(await serveObject(request, response, located.storage, located.key, located.uploaded ? IMMUTABLE_PRIVATE : REVALIDATE, {
            contentType: 'application/json; charset=utf-8',
            etag: true,
            info: located.info,
            ...(purposeHeaders ? { headers: purposeHeaders } : {}),
          }))
        ) {
          send(response, 404, 'replay not found');
        }
        return;
      }
      // HEAD lets the viewer confirm a stored MP4 exists before it offers the download.
      if (replayPath && (request.method === 'GET' || request.method === 'HEAD') && replayPath.video) {
        const headers = { 'content-disposition': `attachment; filename="${replayPath.id}.mp4"` };
        if (
          !(await serveObject(request, response, options.store.storage, options.store.videoKey(replayPath.id), 'private, max-age=3600', {
            headers,
          }))
        ) {
          send(response, 404, 'video not found');
        }
        return;
      }

      // An unknown or malformed API path is a JSON 404, never the SPA page (the viewer would try to parse HTML).
      if (path.startsWith('/api/')) {
        send(response, 404, JSON.stringify({ error: 'not found' }), json);
        return;
      }

      if (options.devIndexHtml && request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        const html = await options.devIndexHtml(`${publicPath(path, defaultBase)}${raw.search}`);
        if (options.beta?.malleable) response.setHeader('content-security-policy', "frame-src 'self' blob: data:");
        await sendCompressed(request, response, 200, indexPage(html, base), 'text/html; charset=utf-8');
        return;
      }

      if (options.devMiddleware) {
        // The dev server's base is the configured public one (vite.config.ts), whichever host asked.
        request.url = `${publicPath(path, defaultBase)}${raw.search}`;
        await new Promise<void>((done) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            done();
          };
          response.once('finish', finish);
          response.once('close', finish);
          options.devMiddleware!(request, response, finish);
        });
        if (response.writableEnded) return;
      } else if (path.startsWith('/assets/')) {
        const file = resolve(options.clientDir, `.${path}`);
        // why: assets/brand/* (favicon, manifest) keep fixed names for index.html, so they must revalidate.
        const cache = path.startsWith('/assets/brand/') ? 'public, max-age=86400' : 'public, max-age=31536000, immutable';
        if (file.startsWith(`${resolve(options.clientDir)}/`) && (await serveFile(request, response, file, cache))) return;
      }

      if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        const html = await readFile(resolve(options.clientDir, 'index.html'), 'utf8').catch(() => undefined);
        if (html) {
          // With user plugins on, the page may only frame itself, blob: and data: URLs: a sandboxed plugin frame that
          // navigates itself somewhere else (to smuggle data out in a URL) is refused by the browser.
          if (options.beta?.malleable) response.setHeader('content-security-policy', "frame-src 'self' blob: data:");
          await sendCompressed(request, response, 200, indexPage(html, base), 'text/html; charset=utf-8');
          return;
        }
      }
      send(response, 404, 'not found');
    } catch (error) {
      fail(request, response, error);
    }
  }

  return async function handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const raw = new URL(request.url ?? '/', 'http://app');
      // The public base of this request: its host's entry in `hosts`, else `basePath`. The host only shapes routes and
      // links; access is still decided by the auth adapter, the same on every host.
      const base = hostBase(request.headers, routing, defaultBase);
      if (vary) response.setHeader('vary', vary);
      const path = appPath(raw.pathname, base);

      // Health checks (load balancer, Docker, deploy curl): `/healthz` always, and `/` for anything that is not
      // a browser page load, so the check path stays the same wherever the app lives.
      if (path === '/healthz' || (path === '/' && !(request.method === 'GET' && isBrowserNavigation(request)))) {
        send(response, 200, 'ok');
        return;
      }
      // A prefixed deployment answers its bare address with the list, so `/replays` and `/replays/` both work.
      watchResponse(registry, request, response, path, () => identities.get(request));
      await traceRequest(request, response, path, () => serve(request, response, raw, path, base));
    } catch (error) {
      fail(request, response, error);
    }
  };
}

/** Headers a thrown `HttpError` carries onto its response (`Retry-After`); none for other errors. */
const errorHeaders = (error: unknown): Record<string, string> => (error instanceof HttpError ? { ...error.headers } : {});

/**
 * The error response for a failed request (http/errors.ts `classifyError`): 4xx answer with their message as text, 5xx with
 * a JSON body (`StoredDataError`'s own message, else `internal error`). The span gets the error's type only, never its message.
 */
function fail(request: IncomingMessage, response: ServerResponse, error: unknown) {
  const { status, message } = classifyError(error);
  recordError(error, status);
  const requestId = request.headers['x-request-id'] ?? request.headers['x-cloud-trace-context'] ?? '-';
  console.error(`request failed: ${request.method} ${request.url?.split('?')[0]} (request ${String(requestId)}, status ${status})`, error);
  const headers = errorHeaders(error);
  if (response.headersSent) response.end();
  else if (status >= 500 || error instanceof StoredDataError)
    send(response, status, JSON.stringify({ error: message }), 'application/json; charset=utf-8', REVALIDATE, headers);
  else send(response, status, message, 'text/plain; charset=utf-8', REVALIDATE, headers);
}
