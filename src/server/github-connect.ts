import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { definePlugin } from '../plugin/define.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { hostName, type HostRouting, requestHost } from './base-path.ts';
import type { PluginMiddlewareContext } from '../plugin/web-types.ts';
import type { Identity } from './auth/types.ts';
import type { GithubConnectSettings } from './github-connect-config.ts';
import { emailDigest, GITHUB_LOGIN, type GithubLink, GithubLinkStore } from './github-connect-store.ts';
import { httpsUrl } from './people.ts';
import type { ObjectStorage } from './storage/types.ts';

/**
 * Connect GitHub, as a built-in plugin loaded when the host sets a GitHub OAuth app (github-connect-config.ts):
 *
 *   GET    <base>/auth/github/start       state cookie + PKCE, then GitHub's authorize page (no scopes: public profile only)
 *                                         `?next=<path>` or `?return=<url>` says where to come back to
 *   GET    <base>/auth/github/callback    checks the state, reads the login from `GET /user`, stores email to login
 *   GET    /api/plugins/github-connect/link      { available, linked: { login, avatarUrl? } | null, start? }
 *   DELETE /api/plugins/github-connect/link      disconnect
 *
 * A stored link is an `api.identity` handle (`handles.github`), so For me, `GET /api/me` and avatars treat it as verified.
 * The access token is used once and revoked; nothing of it is kept.
 *
 * GitHub knows one callback URL, so the whole flow (state cookie, callback) runs on `PUBLIC_ORIGIN`. A person on another
 * host of the same process is sent there (`start` in the link state), and comes back to `return` only when that URL's host
 * is one this server serves (`hosts`, or the public origin's own): never an open redirect.
 */
export const GITHUB_CONNECT_PLUGIN = 'github-connect';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_URL = 'https://api.github.com';
const COOKIE = `${PRODUCT_SLUG}_github_oauth`;
const FLOW_SECONDS = 600;
const TIMEOUT_MS = 10_000;

interface Flow {
  /** The state sent to GitHub. */
  s: string;
  /** The PKCE verifier. */
  v: string;
  /** Digest of the email that started the flow: another person's callback cannot finish it. */
  e: string;
  /** Where to return: a path in this app, or a URL on a host this server serves. */
  n: string;
  /** Expiry, ms since the epoch. */
  x: number;
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A return path inside this app only: never an absolute or protocol-relative URL. */
function returnPath(value: string | null, base: string) {
  const fallback = base || '/';
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\p{Cc}]/u.test(value)) return fallback;
  return value;
}

const text = (status: number, body: string, headers: Record<string, string | string[]> = {}) => {
  const response = new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  for (const [name, value] of Object.entries(headers)) for (const one of [value].flat()) response.headers.append(name, one);
  return response;
};

function redirect(location: string, cookie: string) {
  const response = new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
  if (cookie) response.headers.append('set-cookie', cookie);
  return response;
}

export interface GithubConnectDeps {
  storage: ObjectStorage;
  settings: GithubConnectSettings;
  /** `https://replays.example.com` (PUBLIC_ORIGIN); without it the request's own origin is used. */
  publicOrigin?: string | undefined;
  /** The per-host bases (base-path.ts): the hosts this server serves, which a `return` URL may name. */
  hosts?: HostRouting | undefined;
  /** The base of every host not in `hosts`. */
  defaultBase?: string | undefined;
  /** The host's `api.people` handle kinds, if it set any: a link under a kind it does not list would be dropped, so none is offered. */
  handles: () => readonly { id: string }[] | undefined;
  /** Process boundary for GitHub's two endpoints; tests replace it. */
  fetch?: typeof fetch;
  now?: () => number;
}

interface Env {
  settings: GithubConnectSettings;
  publicOrigin: string | undefined;
  /** The public origin's host name and the base it is served at. */
  publicHost: string | undefined;
  publicBase: string;
  hosts: HostRouting | undefined;
  handles: GithubConnectDeps['handles'];
  httpFetch: typeof fetch;
  now: () => number;
  links: GithubLinkStore;
}

const cookie = (value: string, maxAge: number, base: string, secure: boolean) =>
  `${COOKIE}=${value}; Path=${base || '/'}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const field = (value: object, name: string): unknown => Reflect.get(value, name);

function isFlow(value: unknown): value is Flow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof field(value, 's') === 'string' &&
    typeof field(value, 'v') === 'string' &&
    typeof field(value, 'e') === 'string' &&
    typeof field(value, 'n') === 'string' &&
    typeof field(value, 'x') === 'number'
  );
}

/** A response body as a plain record, or an empty one when it is not a JSON object. */
async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : {};
}

// why: signed under a purpose of its own, so no other cookie can stand in for the flow's.
const sign = (env: Env, payload: string) =>
  createHmac('sha256', env.settings.clientSecret).update(`github-connect:${payload}`).digest('base64url');

function seal(env: Env, flow: Flow) {
  const payload = b64(JSON.stringify(flow));
  return `${payload}.${sign(env, payload)}`;
}

function unseal(env: Env, cookies: string | null): Flow | undefined {
  const raw = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [payload, mac] = raw?.split('.') ?? [];
  if (!payload || !mac || !safeEqual(mac, sign(env, payload))) return;
  try {
    const flow: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return isFlow(flow) && flow.x > env.now() ? flow : undefined;
  } catch {
    return;
  }
}

/** The host a request addressed, by the same rule that picked its base. */
const hostOf = (env: Env, request: Request) =>
  requestHost(
    { host: request.headers.get('host') ?? undefined, 'x-forwarded-host': request.headers.get('x-forwarded-host') ?? undefined },
    env.hosts?.trustForwardedHost ?? false,
  );

/** Whether this request came in on a host other than the public origin's, so its flow has to move there first. */
const onOtherHost = (env: Env, request: Request) => env.publicHost !== undefined && hostOf(env, request) !== env.publicHost;

/**
 * A `return` URL the callback may send the person back to: http(s) on the public origin's scheme, and a host this server
 * serves (a listed host, or the public origin's own). Anything else is dropped, so the callback cannot redirect off-site.
 */
function returnUrl(env: Env, value: string | null) {
  if (!value || value.length > 2048 || !env.publicOrigin || /[\\\p{Cc}]/u.test(value)) return;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return;
  }
  const served = target.host !== '' && (hostName(target.host) === env.publicHost || env.hosts?.bases.has(hostName(target.host)));
  if (target.protocol !== new URL(env.publicOrigin).protocol || target.username || target.password || !served) return;
  return `${target.origin}${target.pathname}${target.search}`;
}

/** `<public origin><its base>/auth/github/start`: where every host sends a person to connect. */
const startUrl = (env: Env) => `${env.publicOrigin}${env.publicBase}/auth/github/start`;

const redirectUri = (env: Env, url: URL, base: string) => `${env.publicOrigin ?? url.origin}${base}/auth/github/callback`;

/** Trades the code for an access token. */
async function requestToken(env: Env, code: string, verifier: string, uri: string) {
  const token = await env.httpFetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.settings.clientId,
      client_secret: env.settings.clientSecret,
      code,
      redirect_uri: uri,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const granted = await jsonRecord(token);
  if (!token.ok || typeof granted.access_token !== 'string') throw new Error(`GitHub refused the code (${token.status})`);
  return granted.access_token;
}

async function requestUser(env: Env, accessToken: string) {
  const response = await env.httpFetch(`${API_URL}/user`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': PRODUCT_SLUG },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const user = await jsonRecord(response);
  if (!response.ok || typeof user.login !== 'string' || !GITHUB_LOGIN.test(user.login))
    throw new Error(`GitHub did not return a login (${response.status})`);
  const avatarUrl = httpsUrl(user.avatar_url);
  return { login: user.login, ...(avatarUrl ? { avatarUrl } : {}) };
}

async function revokeToken(env: Env, accessToken: string) {
  const { clientId, clientSecret } = env.settings;
  try {
    await env.httpFetch(`${API_URL}/applications/${encodeURIComponent(clientId)}/token`, {
      method: 'DELETE',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/json',
        'user-agent': PRODUCT_SLUG,
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // why: a failed revoke must not turn a verified login into an error.
  }
}

/** The login the code's owner holds, and their avatar; the token is revoked straight after. */
async function readAccount(env: Env, code: string, verifier: string, uri: string) {
  const accessToken = await requestToken(env, code, verifier, uri);
  try {
    return await requestUser(env, accessToken);
  } finally {
    await revokeToken(env, accessToken);
  }
}

function start(env: Env, context: PluginMiddlewareContext) {
  const { identity, url, base } = context;
  if (!identity?.email) return text(403, 'Sign in with an email address to connect GitHub.');
  // why: GitHub has one callback URL, so the flow and its state cookie must live on the public origin; another host hands over.
  if (env.publicOrigin && onOtherHost(env, context.request)) {
    const back =
      returnUrl(env, url.searchParams.get('return')) ??
      `${new URL(env.publicOrigin).protocol}//${context.request.headers.get('host') ?? ''}${returnPath(url.searchParams.get('next'), base)}`;
    return redirect(`${startUrl(env)}?${new URLSearchParams({ return: back })}`, '');
  }
  const state = b64(randomBytes(18));
  const verifier = b64(randomBytes(32));
  const flow: Flow = {
    s: state,
    v: verifier,
    e: emailDigest(identity.email),
    n: returnUrl(env, url.searchParams.get('return')) ?? returnPath(url.searchParams.get('next'), base),
    x: env.now() + FLOW_SECONDS * 1000,
  };
  const uri = redirectUri(env, url, base);
  const params = new URLSearchParams({
    client_id: env.settings.clientId,
    redirect_uri: uri,
    state,
    code_challenge: b64(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    allow_signup: 'false',
  });
  // invariant: no `scope`: GitHub then grants read access to the public profile and nothing else.
  return redirect(`${AUTHORIZE_URL}?${params}`, cookie(seal(env, flow), FLOW_SECONDS, base, uri.startsWith('https:')));
}

async function callback(env: Env, context: PluginMiddlewareContext) {
  const { identity, url, base } = context;
  const uri = redirectUri(env, url, base);
  const clear = cookie('', 0, base, uri.startsWith('https:'));
  const flow = unseal(env, context.request.headers.get('cookie'));
  const state = url.searchParams.get('state');
  if (!identity?.email || !flow || !state || !safeEqual(state, flow.s) || flow.e !== emailDigest(identity.email))
    return text(400, 'This GitHub sign-in could not be verified. Start again from the account menu.', { 'set-cookie': clear });
  const code = url.searchParams.get('code');
  // why: GitHub sends `error` (access_denied) when the person cancels; going back quietly is the right answer.
  if (url.searchParams.get('error') || !code) return redirect(flow.n, clear);
  let account: Omit<GithubLink, 'linkedAt'>;
  try {
    account = await readAccount(env, code, flow.v, uri);
  } catch (error) {
    console.error(`plugin ${GITHUB_CONNECT_PLUGIN}: ${error instanceof Error ? error.message : String(error)}`);
    return text(502, 'GitHub did not answer. Try again in a moment.', { 'set-cookie': clear });
  }
  await env.links.set(identity.email, { ...account, linkedAt: new Date(env.now()).toISOString() });
  return redirect(flow.n, clear);
}

function handleAuthPath(env: Env, context: PluginMiddlewareContext) {
  if (context.request.method !== 'GET') return;
  if (context.path === '/auth/github/start') return start(env, context);
  if (context.path === '/auth/github/callback') return callback(env, context);
}

async function resolveIdentity(env: Env, identity: Identity) {
  const link = identity.email ? await env.links.get(identity.email) : undefined;
  if (!link) return;
  return {
    ...identity,
    handles: { ...identity.handles, github: link.login },
    ...(link.avatarUrl && !identity.avatarUrl ? { avatarUrl: link.avatarUrl } : {}),
  };
}

async function linkStatus(env: Env, identity: Identity | undefined) {
  const link = identity?.email ? await env.links.get(identity.email) : undefined;
  // why: a login the host already vouches for needs no link; offering one would be noise.
  const available =
    Boolean(identity?.email) &&
    (env.handles()?.some((handle) => handle.id === 'github') ?? true) &&
    (Boolean(link) || !identity?.handles?.github);
  return Response.json(
    {
      available,
      linked: link ? { login: link.login, ...(link.avatarUrl ? { avatarUrl: link.avatarUrl } : {}) } : null,
      ...(env.publicOrigin ? { start: startUrl(env) } : {}),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

async function unlink(env: Env, identity: Identity | undefined) {
  if (identity?.email) await env.links.remove(identity.email);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function githubConnectPlugin(deps: GithubConnectDeps) {
  const now = deps.now ?? Date.now;
  const publicOrigin = deps.publicOrigin?.replace(/\/+$/, '');
  const publicHost = publicOrigin ? hostName(new URL(publicOrigin).host) : undefined;
  const env: Env = {
    settings: deps.settings,
    publicOrigin,
    publicHost,
    publicBase: (publicHost ? deps.hosts?.bases.get(publicHost) : undefined) ?? deps.defaultBase ?? '',
    hosts: deps.hosts,
    handles: deps.handles,
    httpFetch: deps.fetch ?? fetch,
    now,
    links: new GithubLinkStore(deps.storage, now),
  };
  const path = `/api/plugins/${GITHUB_CONNECT_PLUGIN}/link`;
  return definePlugin({
    name: GITHUB_CONNECT_PLUGIN,
    // why: before the deployment's own plugins, so their resolvers can still replace the handle with their own.
    order: -90,
    setup(api) {
      api.identity({ resolve: (identity) => resolveIdentity(env, identity) });
      api.middleware({ phase: 'post-auth', handle: (context) => handleAuthPath(env, context) });
      api.route({ method: 'GET', path, handler: ({ identity }) => linkStatus(env, identity) });
      api.route({ method: 'DELETE', path, handler: ({ identity }) => unlink(env, identity) });
    },
  });
}
