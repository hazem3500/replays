import { replayDeleteGate, replayReadGate, type ReplayAuthorizer } from './api/data-storage-auth.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sanitizeReplayBundle } from '../capture/sanitize.ts';
import { EMPTY_REGISTRY, mergeRegistries, type PluginRegistry, resolvePluginsSync } from '../plugin/registry.ts';
import { defaultPolicy, type HostVersions, type MalleablePolicy } from '../shared/malleable-policy.ts';
import { mergeRedactionRules, type RedactionRules } from '../shared/redaction.ts';
import { type ReplayBundle } from '../shared/replay.ts';
import { normalizeSignIn, type SignInConfig } from '../shared/sign-in.ts';
import type { SourceProviders } from '../shared/source-providers.ts';
import type { ApplicationRuntime } from './agent-native/runtime.ts';
import { coreRoutes } from './api/index.ts';
import { authenticatedPluginRoutes, publicPluginRoutes } from './api/plugin-routes.ts';
import { confineToEndpoint, routeAllowed, uploadEndpointAt } from './api/upload-endpoints.ts';
import { runRequestPhase } from './app/request-phase.ts';
import { handleReplayFiles } from './app/replay-files.ts';
import { serveShell } from './app/shell.ts';
import { type GateRequest, refuseAnonymous, returnFromSignIn, sendCliCapabilities } from './app/sign-in.ts';
import type { AnyAuthAdapter, AuthRouteContext, Identity } from './auth/types.ts';
import { toNodeAuthAdapter } from './auth/web.ts';
import { appPath, type HostConfig, type HostRouting, hostBase, hostVary, normalizeHosts } from './base-path.ts';
import type { BetaFlags } from './beta.ts';
import type { BrandingConfig } from './branding.ts';
import { BridgeHub } from './bridge-hub.ts';
import type { CommentsSettings } from './comments-config.ts';
import { COMMENTS_PLUGIN, commentsPlugin } from './comments-plugin.ts';
import type { ContextSchema } from './context-schema.ts';
import { type EditingSettings, editingFromEnv } from './editing-config.ts';
import { handleEditsApi } from './edits-routes.ts';
import { fail } from './http/fail.ts';
import { sendWebResponse, toWebRequest } from './http/node.ts';
import { REVALIDATE } from './http/respond.ts';
import { RouteTable } from './http/route.ts';
import { isBrowserNavigation, sameOrigin, send, sendJson } from './http/send.ts';
import { serveFile } from './http/serve-file.ts';
import { renderIndexHtml } from './index-page.ts';
import { handleKeepApi } from './keep-routes.ts';
import { malleablePlugin } from './malleable-plugin.ts';
import { coreVersion } from './package-info.ts';
import type { PageRenderer } from './pages/start.ts';
import type { PrivacySettings } from './privacy-config.ts';
import { identityResolver } from './people.ts';
import { handlePosterApi } from './media/poster-routes.ts';
import { clientAsset, watchResponse } from './plugin-runtime.ts';
import { createRenderHooks } from './render-hooks.ts';
import { handleInternalRender, handleRenderApi, type RenderService } from './render-routes.ts';
import { applyRequestPolicy } from './request-policy.ts';
import { type ReplayStore } from './store.ts';
import { setRequestAttributes, traceRequest, withSpan } from './tracing.ts';
import { ViewCatalog } from './views.ts';

export interface AppOptions {
  /** Main application dispatcher, behind host auth and request policy. */
  application?: ApplicationRuntime;
  signIn?: SignInConfig | false;
  /** Either adapter shape (auth/types.ts); a `WebAuthAdapter` is normalized for the Node server. */
  auth: AnyAuthAdapter;
  store: ReplayStore;
  clientDir: string;
  branding: BrandingConfig;
  /** Resolves `context.sources` references into links; defaults to the built-in providers. */
  sources: SourceProviders;
  /** The deployment's views (src/server/views.ts); default the built-ins. */
  views?: ViewCatalog;
  /** Optional JSON Schema for `context.fields` (context-schema.ts). */
  contextSchema?: ContextSchema;
  devMiddleware?: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
  /** Vite-transformed dev HTML, rendered through the shared server metadata contract. */
  devIndexHtml?: (url: string) => Promise<string>;
  /** Pages rendered by the TanStack Start server entry (src/server/pages/start.ts), with the client build its HTML references. */
  pages?: { renderer: PageRenderer; clientDir: string };
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
  /** Switches that relax a privacy default (`privacy` in the config, src/server/privacy-config.ts); absent means all off. */
  privacy?: PrivacySettings;
}

/** `AppOptions.hosts` as routing: already checked (`loadSettings`), or a plain record checked here. */
function hostRouting(options: AppOptions): HostRouting | undefined {
  const hosts = options.hosts;
  if (!hosts) return undefined;
  if ('bases' in hosts && hosts.bases instanceof Map) return hosts as HostRouting;
  return normalizeHosts(hosts, options.trustForwardedHost ?? false);
}

export function createApp(options: AppOptions) {
  const auth = toNodeAuthAdapter(options.auth);
  const defaultBase = options.basePath ?? '';
  const signIn = normalizeSignIn(options.signIn ?? auth.signIn);
  const routing = hostRouting(options);
  // why: with per-host bases the same path is a different route from one host to the next, so every response varies by it.
  const vary = hostVary(routing);
  const editing = { enabled: editingFromEnv({}, options.editing).enabled && Boolean(options.beta?.editor) };
  // invariant: comments are a built-in plugin loaded first when enabled, so `commentsOn` means "that plugin is loaded".
  const userPlugins = options.plugins ?? EMPTY_REGISTRY;
  const anonymous = auth.name === 'none';
  const policy = options.malleable ?? defaultPolicy();
  const versions = options.versions ?? { core: coreVersion() };
  const builtIns = [
    ...(options.comments?.enabled ? [commentsPlugin({ store: options.store, anonymous })] : []),
    // invariant: beta user plugins and the agent bridge are absent unless the flag is on: no routes, no sandbox page, no bridge.
    ...(options.beta?.malleable
      ? [malleablePlugin({ storage: options.store.storage, anonymous, hub: options.bridgeHub ?? new BridgeHub(), policy, versions })]
      : []),
  ];
  const registry = builtIns.length ? mergeRegistries(resolvePluginsSync(builtIns), userPlugins) : userPlugins;
  const commentsOn = registry.order.includes(COMMENTS_PLUGIN);
  // why: only `beforeRender` gates video exports here; the queues in start.ts run the rest of the render hooks.
  const renderHooks = createRenderHooks(registry.render);
  const beforeRender = renderHooks.checks ? renderHooks.beforeRender : undefined;
  const profiles = options.store.profiles;
  const views = options.views ?? new ViewCatalog();
  const inferable = profiles.list.some((profile) => profile.inferable);
  const redaction = mergeRedactionRules(options.redaction, registry.redaction);
  // why: the privacy pass walks every event, so it gets its own span.
  // invariant: visible inputs need the host's opt-in here and the upload route's staff check; neither alone keeps them.
  const keepVisibleInputs = options.privacy?.keepVisibleInputs === true;
  const sanitize = (bundle: ReplayBundle, upload?: { staff: boolean }) =>
    withSpan('replay.sanitize', { 'replay.event_count': bundle.events.length }, () =>
      sanitizeReplayBundle(bundle, redaction, { keepVisibleInputs: keepVisibleInputs && upload?.staff === true }),
    );
  const answerPublicRoute = publicPluginRoutes(registry);
  const authorizeReplay: ReplayAuthorizer = async (gate, csrfAllowed) => {
    const dispatch: DispatchRequest = {
      ...gate,
      authorizationProbe: true,
      routeContext: { base: gate.base, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) },
    };
    if (await beforeAuth(dispatch, csrfAllowed)) return;
    return identify(dispatch, csrfAllowed);
  };
  const routes = new RouteTable([
    ...coreRoutes({
      canReadReplay: replayReadGate(registry, authorizeReplay),
      canDeleteReplay: replayDeleteGate(registry, authorizeReplay),
      deployment: {
        store: options.store,
        auth,
        sources: options.sources,
        views,
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
  const indexPage = (html: string, base: string) =>
    renderIndexHtml(html, {
      base,
      branding: options.branding,
      profiles: profiles.list,
      views: views.list,
      sources: options.sources.describe(),
      ...(signIn ? { signIn } : {}),
      ...(options.beta ? { beta: options.beta } : {}),
      comments: commentsOn,
      editing,
      clientEntries: registry.clientEntries,
    });
  // why: `onResponse` hooks run after dispatch and need the request's identity.
  const identities = new WeakMap<IncomingMessage, Identity>();
  const resolveIdentity = identityResolver(registry);
  const shell = {
    clientDir: options.clientDir,
    defaultBase,
    malleable: Boolean(options.beta?.malleable),
    brandName: options.branding.name,
    indexPage,
    devIndexHtml: options.devIndexHtml,
    devMiddleware: options.devMiddleware,
    pages: options.pages,
  };

  /* invariant: request policy → pre-auth hooks → adapter auth routes → public plugin routes; answers what needs no identity. */
  async function beforeAuth(gate: DispatchRequest, csrfAllowed: boolean) {
    const { request, response, raw, path, base, webRequest } = gate;
    const hookAnswer = await runRequestPhase(registry, 'pre-auth', gate);
    if (hookAnswer) {
      if (hookAnswer !== true) await answer(gate, hookAnswer);
      return true;
    }
    // why: the adapter's own routes (sign-in, callback) run without an identity.
    if (auth.handle && auth.routes?.includes(path) && (await auth.handle(request, response, gate.routeContext))) return true;
    if (
      registry.routes.length &&
      (await answer(gate, await answerPublicRoute({ request: webRequest(), url: raw, path, base, crossSiteAllowed: csrfAllowed })))
    )
      return true;
    // why: the CLI auth contract is public and credential-free, separate from the viewer config, so it works before sign-in.
    if (path === '/api/cli/auth/capabilities' && request.method === 'GET') {
      await sendCliCapabilities(response, auth, gate.routeContext);
      return true;
    }
    return false;
  }

  /* invariant: authentication → identity resolvers → endpoint scope → CSRF → application authorization; undefined when refused. */
  async function identify(gate: DispatchRequest, csrfAllowed: boolean): Promise<Identity | undefined> {
    const { request, response, path } = gate;
    // invariant: an endpoint's own credentials replace the deployment adapter on its path only, and confine the identity to it.
    const endpointAuth = uploadEndpointAt(registry, path)?.authenticate;
    const authenticated: Identity | undefined = endpointAuth ? await endpointAuth(request) : await auth.authenticate(request);
    if (!authenticated) {
      if (endpointAuth) send(response, 401, 'credentials required', { cacheControl: 'no-store' });
      else refuseAnonymous(gate, auth, signIn, gate.routeContext);
      return undefined;
    }
    // invariant: identity resolvers (api.identity) may add a name and avatar; never another id.
    const user = await resolveIdentity(endpointAuth ? confineToEndpoint(authenticated, path) : authenticated, {
      request,
      webRequest: gate.webRequest(),
    });
    identities.set(request, user);
    const denied = routeAllowed(registry, user, request.method ?? 'GET', path);
    if (denied) {
      send(response, 403, denied);
      return undefined;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET') && !sameOrigin(request) && !csrfAllowed) {
      send(response, 403, 'cross-site request');
      return undefined;
    }
    await options.application?.authorize(request, path, user);
    return user;
  }

  /** invariant: post-auth hooks → the sign-in return → core and plugin routes → feature APIs → replay files → shell. */
  async function afterAuth(gate: DispatchRequest, user: Identity, csrfAllowed: boolean) {
    const { request, response, raw, path, base, webRequest } = gate;
    const hookAnswer = await runRequestPhase(registry, 'post-auth', gate, user);
    if (hookAnswer) {
      if (hookAnswer !== true) await answer(gate, hookAnswer);
      return;
    }
    if (signIn && path === signIn.path) {
      returnFromSignIn(gate, signIn, vary);
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
        crossSiteAllowed: csrfAllowed,
        hooks: { request, webRequest: webRequest() },
      });
      await sendWebResponse(response, page, request.method);
      return;
    }
    if (await options.application?.handle(request, response, path, user)) return;
    if (await serveFeature(gate, user)) return;
    // why: an unknown or malformed API path is a JSON 404, never the SPA page (the viewer would try to parse HTML).
    if (path.startsWith('/api/')) sendJson(response, 404, { error: 'not found' });
    else await serveShell(request, response, gate, shell);
  }

  async function serveFeature(gate: DispatchRequest, user: Identity) {
    const { request, response, raw, path } = gate;
    const { store } = options;
    const asset = request.method === 'GET' || request.method === 'HEAD' ? clientAsset(registry, path) : undefined;
    if (asset) {
      if (!(await serveFile(request, response, asset.file, { cacheControl: REVALIDATE, contentType: asset.contentType, etag: true })))
        send(response, 404, 'not found');
      return true;
    }
    return (
      (await handleRenderApi(request, response, path, raw.searchParams, { ...options, beforeRender, identity: user })) ||
      (await handlePosterApi(request, response, path, { store, posters: options.render?.posters })) ||
      (await handleKeepApi(request, response, path, { store, user: user.id })) ||
      (Boolean(options.beta?.editor) && (await handleEditsApi(request, response, path, { store, user: user.id, editing }))) ||
      (await handleReplayFiles(request, response, path, { store, inferable }))
    );
  }

  async function serve(gate: DispatchRequest) {
    const { request, response, path } = gate;
    try {
      // invariant: loopback + per-process token only (render-routes.ts); never reachable through the public path.
      if (path.startsWith('/internal/render/')) {
        await handleInternalRender(request, response, path, options);
        return;
      }
      const requestPolicy = applyRequestPolicy(registry, request, response, path);
      if (requestPolicy.handled || (await beforeAuth(gate, requestPolicy.csrfAllowed))) return;
      const user = await identify(gate, requestPolicy.csrfAllowed);
      if (user) await afterAuth(gate, user, requestPolicy.csrfAllowed);
    } catch (error) {
      fail(request, response, error);
    }
  }

  return async function handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const raw = new URL(request.url ?? '/', 'http://app');
      // why: the host only shapes routes and links; access is still decided by the auth adapter, the same on every host.
      const base = hostBase(request.headers, routing, defaultBase);
      if (vary) response.setHeader('vary', vary);
      const path = appPath(raw.pathname, base);
      // why: load balancer, Docker and deploy checks use `/healthz`, or `/` when it is not a browser page load, wherever the app lives.
      if (path === '/healthz' || (path === '/' && !(request.method === 'GET' && isBrowserNavigation(request)))) {
        send(response, 200, 'ok');
        return;
      }
      watchResponse(registry, request, response, path, () => identities.get(request));
      let web: Request | undefined;
      const gate: DispatchRequest = {
        request,
        response,
        raw,
        path,
        base,
        routeContext: { base, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) },
        webRequest: () => (web ??= toWebRequest(request, response)),
      };
      await traceRequest(request, response, path, () => serve(gate));
    } catch (error) {
      fail(request, response, error);
    }
  };
}

/** One request through the dispatch: its parsed URL, app path, public base and lazily built web `Request`. */
interface DispatchRequest extends GateRequest {
  authorizationProbe?: true;
  routeContext: AuthRouteContext;
  webRequest: () => Request;
}

/** Sends a web `Response` a hook or plugin route answered with; false when it passed. */
async function answer(gate: DispatchRequest, page: Response | undefined): Promise<boolean> {
  if (page && gate.authorizationProbe) await page.body?.cancel();
  else if (page) await sendWebResponse(gate.response, page, gate.request.method);
  return Boolean(page);
}
