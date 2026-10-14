import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { jwksKeys, verifyJwt, type JwtClaims, type KeySource } from './jwt.ts';
import type { AuthAdapter, AuthRouteContext, Identity } from './types.ts';

export interface OidcOptions {
  /** The issuer URL; `/.well-known/openid-configuration` is read from it. */
  issuer: string;
  clientId: string;
  clientSecret?: string;
  /** HMAC key for the session and login cookies (32+ random bytes, base64 or hex is fine). */
  sessionSecret: string;
  /** Public origin of this app (`https://replays.example.com`); the redirect URI is `<origin><base>/auth/callback`. */
  publicOrigin: string;
  scopes?: string;
  /** Accepted `aud` for bearer tokens (machine uploads); defaults to the client id. */
  audience?: string;
  /** Optional allowlist: exact emails or `@domain` suffixes. Empty: every user the provider authenticates. */
  allow?: readonly string[];
  sessionHours?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const ROUTES = ['/auth/login', '/auth/callback', '/auth/logout'];
const SESSION_COOKIE = 'rk_session';
const LOGIN_COOKIE = 'rk_login';

function b64(value: Buffer | string) {
  return Buffer.from(value).toString('base64url');
}

function cookies(request: IncomingMessage) {
  const jar = new Map<string, string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/** A path inside this app only: never an absolute or protocol-relative URL (open-redirect guard). */
export function safeNext(value: string | null | undefined, base: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\r\n]/.test(value)) return `${base}/`;
  return value;
}

export function oidcAuth(options: OidcOptions): AuthAdapter {
  if (options.sessionSecret.length < 16) throw new Error('OIDC_SESSION_SECRET must be at least 16 characters');
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.now ?? Date.now;
  const secure = options.publicOrigin.startsWith('https:');
  const issuer = options.issuer.replace(/\/+$/, '');
  let discovery: Promise<Discovery> | undefined;
  let keys: KeySource | undefined;

  const discover = () =>
    (discovery ??= (async () => {
      const response = await fetcher(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Object.assign(new Error(`OIDC discovery failed (${response.status})`), { status: 502 });
      const found = (await response.json()) as Discovery;
      if (found.issuer.replace(/\/+$/, '') !== issuer) throw Object.assign(new Error('OIDC discovery issuer mismatch'), { status: 502 });
      keys = jwksKeys(found.jwks_uri, fetcher, nowMs);
      return found;
    })().catch((error: unknown) => {
      discovery = undefined;
      throw error;
    }));

  // Each cookie kind is signed under its own purpose, so a login cookie can never be replayed as a session.
  const mac = (purpose: string, body: string) => createHmac('sha256', options.sessionSecret).update(`${purpose}.${body}`).digest();
  const sign = (purpose: string, payload: object) => {
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(mac(purpose, body))}`;
  };
  const unsign = <T>(purpose: string, value: string | undefined): T | undefined => {
    if (!value) return undefined;
    const [body = '', signature = ''] = value.split('.');
    const expected = mac(purpose, body);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: number };
      return typeof parsed.exp === 'number' && parsed.exp * 1000 > nowMs() ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const allowed = (email: string | undefined) => {
    if (!options.allow?.length) return true;
    const lower = email?.toLowerCase();
    return (
      !!lower &&
      options.allow.some((entry) => (entry.startsWith('@') ? lower.endsWith(entry.toLowerCase()) : lower === entry.toLowerCase()))
    );
  };

  const identityOf = (claims: JwtClaims): Identity | undefined => {
    const email = typeof claims.email === 'string' ? claims.email : undefined;
    if (!allowed(email)) return undefined;
    const id = email ?? (typeof claims.sub === 'string' ? claims.sub : undefined);
    if (!id) return undefined;
    const name = typeof claims.name === 'string' ? claims.name : undefined;
    return { id, ...(email ? { email } : {}), ...(name ? { name } : {}) };
  };

  const cookie = (name: string, value: string, maxAge: number, path: string) =>
    `${name}=${value}; Path=${path || '/'}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  const redirectUri = (context: AuthRouteContext) => `${options.publicOrigin.replace(/\/+$/, '')}${context.base}/auth/callback`;

  return {
    name: 'oidc',
    routes: ROUTES,

    async authenticate(request) {
      const session = unsign<Identity & { exp: number }>('session', cookies(request).get(SESSION_COOKIE));
      if (session && typeof session.id === 'string' && session.id)
        return { id: session.id, ...(session.email ? { email: session.email } : {}), ...(session.name ? { name: session.name } : {}) };
      const bearer = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization ?? ''))?.[1];
      if (!bearer) return undefined;
      await discover();
      const claims = await verifyJwt(bearer, {
        keys: keys!,
        issuer,
        audience: options.audience ?? options.clientId,
        now: nowMs() / 1000,
      });
      return claims ? identityOf(claims) : undefined;
    },

    loginUrl(request, context) {
      const next = request.url ?? '/';
      return `${context.base}/auth/login?next=${encodeURIComponent(next)}`;
    },

    async handle(request, response: ServerResponse, context) {
      const url = new URL(request.url ?? '/', 'http://local');
      const path = url.pathname.slice(context.base.length) || '/';
      if (!ROUTES.includes(path)) return false;
      const secureCookies = { path: context.base || '/' };

      if (path === '/auth/logout') {
        response.writeHead(302, {
          'set-cookie': cookie(SESSION_COOKIE, '', 0, secureCookies.path),
          location: `${context.base}/`,
          'cache-control': 'no-store',
        });
        response.end();
        return true;
      }

      if (path === '/auth/login') {
        const found = await discover();
        const state = b64(randomBytes(18));
        const nonce = b64(randomBytes(18));
        const verifier = b64(randomBytes(32));
        const challenge = b64(createHash('sha256').update(verifier).digest());
        const next = safeNext(url.searchParams.get('next'), context.base);
        const login = sign('login', { state, nonce, verifier, next, exp: nowMs() / 1000 + 600 });
        const target = new URL(found.authorization_endpoint);
        target.search = new URLSearchParams({
          response_type: 'code',
          client_id: options.clientId,
          redirect_uri: redirectUri(context),
          scope: options.scopes ?? 'openid email profile',
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString();
        response.writeHead(302, {
          location: target.toString(),
          'set-cookie': cookie(LOGIN_COOKIE, login, 600, secureCookies.path),
          'cache-control': 'no-store',
        });
        response.end();
        return true;
      }

      // /auth/callback
      const login = unsign<{ state: string; nonce: string; verifier: string; next: string }>('login', cookies(request).get(LOGIN_COOKIE));
      const code = url.searchParams.get('code');
      if (!login || !code || url.searchParams.get('state') !== login.state) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('sign-in failed: the login session expired, try again');
        return true;
      }
      const found = await discover();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(context),
        client_id: options.clientId,
        code_verifier: login.verifier,
        ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
      });
      const exchanged = await fetcher(found.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const tokens = exchanged.ok ? ((await exchanged.json()) as { id_token?: string }) : undefined;
      const claims = tokens?.id_token
        ? await verifyJwt(tokens.id_token, { keys: keys!, issuer, audience: options.clientId, nonce: login.nonce, now: nowMs() / 1000 })
        : undefined;
      const identity = claims ? identityOf(claims) : undefined;
      if (!identity) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('sign-in refused');
        return true;
      }
      const hours = options.sessionHours ?? 12;
      response.writeHead(302, {
        location: safeNext(login.next, context.base),
        'set-cookie': [
          cookie(SESSION_COOKIE, sign('session', { ...identity, exp: nowMs() / 1000 + hours * 3600 }), hours * 3600, secureCookies.path),
          cookie(LOGIN_COOKIE, '', 0, secureCookies.path),
        ],
        'cache-control': 'no-store',
      });
      response.end();
      return true;
    },
  };
}
