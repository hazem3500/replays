import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { definePlugin } from '../plugin/define.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import type { PluginMiddlewareContext } from '../plugin/web-types.ts';
import type { GithubConnectSettings } from './github-connect-config.ts';
import { emailDigest, GITHUB_LOGIN, type GithubLink, GithubLinkStore } from './github-connect-store.ts';
import { httpsUrl } from './people.ts';
import type { ObjectStorage } from './storage/types.ts';

/**
 * Connect GitHub, as a built-in plugin loaded when the host sets a GitHub OAuth app (github-connect-config.ts):
 *
 *   GET    <base>/auth/github/start       state cookie + PKCE, then GitHub's authorize page (no scopes: public profile only)
 *   GET    <base>/auth/github/callback    checks the state, reads the login from `GET /user`, stores email to login
 *   GET    /api/plugins/github-connect/link      { available, linked: { login, avatarUrl? } | null }
 *   DELETE /api/plugins/github-connect/link      disconnect
 *
 * A stored link is an `api.identity` handle (`handles.github`), so For me, `GET /api/me` and avatars treat it as verified.
 * The access token is used once and revoked; nothing of it is kept.
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
  /** Where to return, a path in this app. */
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
  response.headers.append('set-cookie', cookie);
  return response;
}

export interface GithubConnectDeps {
  storage: ObjectStorage;
  settings: GithubConnectSettings;
  /** `https://replays.example.com` (PUBLIC_ORIGIN); without it the request's own origin is used. */
  publicOrigin?: string | undefined;
  /** False when the host's `api.people` handles leave out `github`: a link would be dropped, so none is offered. */
  /** The host's `api.people` handle kinds, if it set any: a link under a kind it does not list would be dropped, so none is offered. */
  handles: () => readonly { id: string }[] | undefined;
  /** Process boundary for GitHub's two endpoints; tests replace it. */
  fetch?: typeof fetch;
  now?: () => number;
}

const cookie = (value: string, maxAge: number, base: string, secure: boolean) =>
  `${COOKIE}=${value}; Path=${base || '/'}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function githubConnectPlugin(deps: GithubConnectDeps) {
  const { settings } = deps;
  const httpFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const links = new GithubLinkStore(deps.storage, now);

  // why: signed under a purpose of its own, so no other cookie can stand in for the flow's.
  const sign = (payload: string) => createHmac('sha256', settings.clientSecret).update(`github-connect:${payload}`).digest('base64url');
  const seal = (flow: Flow) => {
    const payload = b64(JSON.stringify(flow));
    return `${payload}.${sign(payload)}`;
  };
  function unseal(cookies: string | null): Flow | undefined {
    const raw = cookies
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const [payload, mac] = raw?.split('.') ?? [];
    if (!payload || !mac || !safeEqual(mac, sign(payload))) return undefined;
    try {
      const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow;
      return typeof flow.s === 'string' && typeof flow.v === 'string' && typeof flow.e === 'string' && typeof flow.n === 'string' && flow.x > now()
        ? flow
        : undefined;
    } catch {
      return undefined;
    }
  }

  const redirectUri = (url: URL, base: string) => `${deps.publicOrigin ?? url.origin}${base}/auth/github/callback`;

  /** The login the code's owner holds, and their avatar; the token is revoked straight after. */
  async function readAccount(code: string, verifier: string, uri: string) {
    const token = await httpFetch(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        redirect_uri: uri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const granted = (await token.json()) as { access_token?: unknown };
    if (!token.ok || typeof granted.access_token !== 'string') throw new Error(`GitHub refused the code (${token.status})`);
    const accessToken = granted.access_token;
    try {
      const response = await httpFetch(`${API_URL}/user`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': PRODUCT_SLUG },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const user = (await response.json()) as { login?: unknown; avatar_url?: unknown };
      if (!response.ok || typeof user.login !== 'string' || !GITHUB_LOGIN.test(user.login))
        throw new Error(`GitHub did not return a login (${response.status})`);
      const avatarUrl = httpsUrl(user.avatar_url);
      return { login: user.login, ...(avatarUrl ? { avatarUrl } : {}) };
    } finally {
      await httpFetch(`${API_URL}/applications/${encodeURIComponent(settings.clientId)}/token`, {
        method: 'DELETE',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
          'content-type': 'application/json',
          'user-agent': PRODUCT_SLUG,
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => undefined);
    }
  }

  function start(context: PluginMiddlewareContext) {
    const { identity, url, base } = context;
    if (!identity?.email) return text(403, 'Sign in with an email address to connect GitHub.');
    const state = b64(randomBytes(18));
    const verifier = b64(randomBytes(32));
    const flow: Flow = {
      s: state,
      v: verifier,
      e: emailDigest(identity.email),
      n: returnPath(url.searchParams.get('next'), base),
      x: now() + FLOW_SECONDS * 1000,
    };
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: redirectUri(url, base),
      state,
      code_challenge: b64(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      allow_signup: 'false',
    });
    // invariant: no `scope`: GitHub then grants read access to the public profile and nothing else.
    return redirect(`${AUTHORIZE_URL}?${params}`, cookie(seal(flow), FLOW_SECONDS, base, redirectUri(url, base).startsWith('https:')));
  }

  async function callback(context: PluginMiddlewareContext) {
    const { identity, url, base } = context;
    const secure = redirectUri(url, base).startsWith('https:');
    const clear = cookie('', 0, base, secure);
    const flow = unseal(context.request.headers.get('cookie'));
    const state = url.searchParams.get('state');
    if (!identity?.email || !flow || !state || !safeEqual(state, flow.s) || flow.e !== emailDigest(identity.email))
      return text(400, 'This GitHub sign-in could not be verified. Start again from the account menu.', { 'set-cookie': clear });
    const code = url.searchParams.get('code');
    // why: GitHub sends `error` (access_denied) when the person cancels; going back quietly is the right answer.
    if (url.searchParams.get('error') || !code) return redirect(flow.n, clear);
    let account: Omit<GithubLink, 'linkedAt'>;
    try {
      account = await readAccount(code, flow.v, redirectUri(url, base));
    } catch (error) {
      console.error(`plugin ${GITHUB_CONNECT_PLUGIN}: ${error instanceof Error ? error.message : error}`);
      return text(502, 'GitHub did not answer. Try again in a moment.', { 'set-cookie': clear });
    }
    await links.set(identity.email, { ...account, linkedAt: new Date(now()).toISOString() });
    return redirect(flow.n, clear);
  }

  return definePlugin({
    name: GITHUB_CONNECT_PLUGIN,
    // why: before the deployment's own plugins, so their resolvers can still replace the handle with their own.
    order: -90,
    setup(api) {
      api.identity({
        async resolve(identity) {
          const link = identity.email ? await links.get(identity.email) : undefined;
          if (!link) return undefined;
          return {
            ...identity,
            handles: { ...identity.handles, github: link.login },
            ...(link.avatarUrl && !identity.avatarUrl ? { avatarUrl: link.avatarUrl } : {}),
          };
        },
      });
      api.middleware({
        phase: 'post-auth',
        handle(context) {
          if (context.request.method !== 'GET') return undefined;
          if (context.path === '/auth/github/start') return start(context);
          if (context.path === '/auth/github/callback') return callback(context);
          return undefined;
        },
      });
      api.route({
        method: 'GET',
        path: `/api/plugins/${GITHUB_CONNECT_PLUGIN}/link`,
        async handler({ identity }) {
          const link = identity?.email ? await links.get(identity.email) : undefined;
          // why: a login the host already vouches for needs no link; offering one would be noise.
          const available = Boolean(identity?.email) && (deps.handles()?.some((handle) => handle.id === 'github') ?? true) && (Boolean(link) || !identity?.handles?.github);
          return Response.json(
            { available, linked: link ? { login: link.login, ...(link.avatarUrl ? { avatarUrl: link.avatarUrl } : {}) } : null },
            { headers: { 'cache-control': 'no-store' } },
          );
        },
      });
      api.route({
        method: 'DELETE',
        path: `/api/plugins/${GITHUB_CONNECT_PLUGIN}/link`,
        async handler({ identity }) {
          if (identity?.email) await links.remove(identity.email);
          return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
        },
      });
    },
  });
}
