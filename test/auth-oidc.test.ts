import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { oidcAuth, safeNext } from '../src/server/auth/oidc.ts';
import { authFromEnv } from '../src/server/auth/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

const CLIENT_ID = 'replays-client';
const CLIENT_SECRET = 'client-secret-for-tests';
const SESSION_SECRET = 'a-session-secret-of-at-least-16-chars';
const PUBLIC_ORIGIN = 'https://replays.example.test';

let signingKey: KeyObject;
let jwk: Record<string, unknown>;
let otherKey: KeyObject;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  signingKey = pair.privateKey;
  jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
});

interface MintOptions {
  key?: KeyObject;
  kid?: string;
  alg?: string;
}

function mint(claims: Record<string, unknown>, options: MintOptions = {}) {
  const header = b64(JSON.stringify({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'test-key', typ: 'JWT' }));
  const payload = b64(JSON.stringify(claims));
  const signature = options.alg === 'none' ? '' : b64(sign('sha256', Buffer.from(`${header}.${payload}`), options.key ?? signingKey));
  return `${header}.${payload}.${signature}`;
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

/** The cookies a response sets, as a `cookie` request header (what a browser would send back). */
const jar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');

const upload = (origin: string, token: string, id = 'machine-upload') =>
  fetch(`${origin}/api/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(replay(id)),
  });

interface Pending {
  nonce: string;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

/** An in-process identity provider: discovery, JWKS, and a token endpoint that checks the code, PKCE and client. */
async function startIdp(clock: () => number) {
  const codes = new Map<string, Pending>();
  const tokenRequests: URLSearchParams[] = [];
  const state = {
    issuerInDiscovery: undefined as string | undefined,
    tokenStatus: 200,
    nonceOverride: undefined as string | undefined,
    audience: CLIENT_ID,
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://idp');
      const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (url.pathname === '/.well-known/openid-configuration') {
        return sendJson(response, 200, {
          issuer: state.issuerInDiscovery ?? issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (url.pathname === '/jwks') return sendJson(response, 200, { keys: [jwk] });
      if (url.pathname === '/token' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        tokenRequests.push(form);
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const valid =
          state.tokenStatus === 200 &&
          pending &&
          form.get('grant_type') === 'authorization_code' &&
          form.get('client_id') === CLIENT_ID &&
          form.get('client_secret') === CLIENT_SECRET &&
          form.get('redirect_uri') === pending.redirectUri &&
          b64(createHash('sha256').update(verifier).digest()) === pending.challenge;
        if (!valid) return sendJson(response, state.tokenStatus === 200 ? 400 : state.tokenStatus, { error: 'invalid_grant' });
        const now = Math.floor(clock() / 1000);
        return sendJson(response, 200, {
          id_token: mint({
            iss: issuer,
            aud: state.audience,
            iat: now,
            exp: now + 300,
            nonce: state.nonceOverride ?? pending.nonce,
            ...pending.claims,
          }),
        });
      }
      sendJson(response, 404, { error: 'not found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    state,
    tokenRequests,
    /** What the identity provider does after the user signs in: remembers the request and returns a code. */
    authorize(authorizeUrl: string, claims: Record<string, unknown>) {
      const params = new URL(authorizeUrl).searchParams;
      const code = b64(randomBytes(12));
      codes.set(code, {
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        claims,
      });
      return code;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface Setup {
  allow?: string[];
  audience?: string;
  basePath?: string;
  sessionHours?: number;
  signIn?: { path: string };
}

async function start(setup: Setup = {}) {
  const clock = { now: Date.parse('2026-10-14T10:00:00.000Z') };
  const idp = await startIdp(() => clock.now);
  closers.push(idp.close);
  const base = setup.basePath ?? '';
  const root = await mkdtemp(join(tmpdir(), 'replays-oidc-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const handle = createApp({
    ...appDefaults(),
    auth: oidcAuth({
      issuer: idp.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      sessionSecret: SESSION_SECRET,
      publicOrigin: PUBLIC_ORIGIN,
      now: () => clock.now,
      ...(setup.allow ? { allow: setup.allow } : {}),
      ...(setup.audience ? { audience: setup.audience } : {}),
      ...(setup.sessionHours ? { sessionHours: setup.sessionHours } : {}),
    }),
    store,
    clientDir: join(root, 'client'),
    basePath: base,
    ...(setup.signIn ? { signIn: setup.signIn } : {}),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, { redirect: 'manual', headers });

  /** The whole browser flow: start login, sign in at the provider, come back to the callback. */
  async function signIn(claims: Record<string, unknown> = { sub: 'user-1', email: 'ada@example.com', name: 'Ada Example' }, next?: string) {
    const login = await get(`${base}/auth/login${next === undefined ? '' : `?next=${encodeURIComponent(next)}`}`);
    const authorizeUrl = login.headers.get('location')!;
    const loginCookie = jar(login);
    const params = new URL(authorizeUrl).searchParams;
    const code = idp.authorize(authorizeUrl, claims);
    const callback = await get(`${base}/auth/callback?code=${code}&state=${params.get('state')}`, { cookie: loginCookie });
    return { login, authorizeUrl, params, loginCookie, code, callback, session: jar(callback) };
  }

  return { idp, clock, origin, base, get, signIn };
}

const bearerClaims = (issuer: string, extra: Record<string, unknown> = {}, now = Date.parse('2026-10-14T10:00:00.000Z') / 1000) => ({
  iss: issuer,
  aud: CLIENT_ID,
  sub: 'ci-bot',
  iat: now,
  exp: now + 300,
  ...extra,
});

describe('safeNext', () => {
  it('keeps paths inside the app and falls back to the base for anything else', () => {
    expect(safeNext('/r/abc?t=1', '')).toBe('/r/abc?t=1');
    expect(safeNext('/replays/s/suite', '/replays')).toBe('/replays/s/suite');
    expect(safeNext(undefined, '')).toBe('/');
    expect(safeNext(null, '/replays')).toBe('/replays/');
    expect(safeNext('', '/replays')).toBe('/replays/');
    for (const bad of [
      'https://evil.example/',
      '//evil.example/path',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'r/relative',
      '/ok\r\nSet-Cookie: x=1',
      '/a\nb',
    ])
      expect(safeNext(bad, '/replays')).toBe('/replays/');
  });
});

describe('oidcAuth setup', () => {
  it('needs a session secret of at least 16 characters', () => {
    expect(() =>
      oidcAuth({ issuer: 'https://idp.example.test', clientId: 'c', sessionSecret: 'short', publicOrigin: PUBLIC_ORIGIN }),
    ).toThrow(/OIDC_SESSION_SECRET/);
  });

  it('is built from OIDC_* variables and names the first missing one', async () => {
    const env = {
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://idp.example.test',
      OIDC_CLIENT_ID: 'client',
      OIDC_SESSION_SECRET: SESSION_SECRET,
      PUBLIC_ORIGIN,
    };
    expect((await authFromEnv(env)).name).toBe('oidc');
    await expect(authFromEnv({ ...env, OIDC_CLIENT_ID: '' })).rejects.toThrow(/needs OIDC_CLIENT_ID/);
    await expect(authFromEnv({ ...env, OIDC_SESSION_SECRET: undefined })).rejects.toThrow(/needs OIDC_SESSION_SECRET/);
    await expect(authFromEnv({ ...env, PUBLIC_ORIGIN: undefined })).rejects.toThrow(/needs PUBLIC_ORIGIN/);
    await expect(authFromEnv({ ...env, OIDC_SESSION_SECRET: 'short' })).rejects.toThrow(/at least 16/);
  });
});

describe('login flow', () => {
  for (const path of ['/api/sign-in', '/auth/return']) {
    it(`starts OIDC recovery at ${path} and returns through its authenticated endpoint`, async () => {
      const { get, signIn } = await start({ basePath: '/tools', signIn: { path } });
      const original = '/tools/a/../r/some-replay?t=2#step-3';
      const normalized = '/tools/r/some-replay?t=2#step-3';
      const recovery = await get(`/tools${path}?next=${encodeURIComponent(original)}`, {
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
      });
      expect(recovery.status).toBe(302);
      const login = new URL(recovery.headers.get('location')!, PUBLIC_ORIGIN);
      expect(login.pathname).toBe('/tools/auth/login');
      const returnTo = login.searchParams.get('next')!;
      const returned = new URL(returnTo, PUBLIC_ORIGIN);
      expect(returned.pathname).toBe(`/tools${path}`);
      expect(returned.searchParams.get('next')).toBe(normalized);
      const { callback, session } = await signIn(undefined, returnTo);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe(returnTo);
      const complete = await get(returnTo, { cookie: session });
      expect(complete.status).toBe(302);
      expect(complete.headers.get('location')).toBe(normalized);
      for (const api of ['/tools/api/me', '/tools/api/replays']) {
        const refused = await get(api, { accept: 'text/html', 'sec-fetch-mode': 'navigate' });
        expect(refused.status).toBe(401);
        expect(refused.headers.get('location')).toBeNull();
      }
      expect((await get(`/tools${path}`)).status).toBe(401);
      const unsafe = await get(`/tools${path}?next=${encodeURIComponent('/.//evil.example')}`, { accept: 'text/html' });
      const safeReturn = new URL(new URL(unsafe.headers.get('location')!, PUBLIC_ORIGIN).searchParams.get('next')!, PUBLIC_ORIGIN);
      expect(safeReturn.searchParams.get('next')).toBe('/tools/');
    });
  }

  it('sends a browser without a session to the login route, and an API client a 401', async () => {
    const { get } = await start();
    const page = await get('/r/abc', { accept: 'text/html', 'sec-fetch-mode': 'navigate' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/auth/login?next=%2Fr%2Fabc');
    const api = await get('/api/replays');
    expect(api.status).toBe(401);
    expect((await get('/api/me')).status).toBe(401);
    // The health check stays open.
    expect(await (await get('/healthz')).text()).toBe('ok');
  });

  it('redirects to the provider with state, nonce and a PKCE S256 challenge, and sets a login cookie', async () => {
    const { signIn, idp } = await start();
    const { login, params } = await signIn();
    expect(login.status).toBe(302);
    const location = new URL(login.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${idp.issuer}/authorize`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/auth/callback`);
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(params.get('nonce')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(params.get('state')).not.toBe(params.get('nonce'));
    expect(login.headers.get('cache-control')).toBe('no-store');
    const cookie = login.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^rk_login=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    // Each login gets its own state, nonce and verifier.
    const second = (await signIn()).params;
    expect(second.get('state')).not.toBe(params.get('state'));
    expect(second.get('nonce')).not.toBe(params.get('nonce'));
    expect(second.get('code_challenge')).not.toBe(params.get('code_challenge'));
  });

  it('completes the flow: code exchange with the PKCE verifier, a session cookie, and a redirect back', async () => {
    const { signIn, idp, get } = await start();
    const { callback, session, params } = await signIn(
      { sub: 'user-1', email: 'ada@example.com', name: 'Ada Example' },
      '/r/some-replay?t=5',
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/r/some-replay?t=5');
    expect(callback.headers.get('cache-control')).toBe('no-store');
    const cookies = callback.headers.getSetCookie();
    expect(cookies.find((line) => line.startsWith('rk_session='))).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);
    // The login cookie is cleared.
    expect(cookies.find((line) => line.startsWith('rk_login='))).toMatch(/^rk_login=; .*Max-Age=0/);
    // The app sent the verifier, the client credentials and the same redirect URI the provider saw.
    const exchange = idp.tokenRequests.at(-1)!;
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('client_secret')).toBe(CLIENT_SECRET);
    expect(exchange.get('redirect_uri')).toBe(params.get('redirect_uri'));
    expect(b64(createHash('sha256').update(exchange.get('code_verifier')!).digest())).toBe(params.get('code_challenge'));

    const me = await get('/api/me', { cookie: session });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Example',
      session: { signedIn: true, signOutUrl: '/auth/logout' },
    });
    expect((await get('/api/replays', { cookie: session })).status).toBe(200);
  });

  it('uses the subject as the identity when the token carries no email', async () => {
    const { signIn, get } = await start();
    const { session } = await signIn({ sub: 'user-42' });
    expect(await (await get('/api/me', { cookie: session })).json()).toEqual({
      id: 'user-42',
      session: { signedIn: true, signOutUrl: '/auth/logout' },
    });
  });

  it('never redirects off site: an unsafe next falls back to the app root', async () => {
    const { signIn } = await start();
    for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const { callback } = await signIn(undefined, next);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/');
    }
    expect((await signIn()).callback.headers.get('location')).toBe('/');
  });

  it('works under a base path: login link, cookie path, redirect URI and fallback', async () => {
    const { get, signIn } = await start({ basePath: '/replays' });
    const page = await get('/replays/r/abc', { accept: 'text/html' });
    expect(page.headers.get('location')).toBe('/replays/auth/login?next=%2Freplays%2Fr%2Fabc');
    const { login, params, callback, session } = await signIn(undefined, '/replays/r/abc');
    expect(params.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/replays/auth/callback`);
    expect(login.headers.getSetCookie()[0]).toContain('Path=/replays;');
    expect(callback.headers.get('location')).toBe('/replays/r/abc');
    const me = await get('/replays/api/me', { cookie: session });
    expect(me.status).toBe(200);
    expect((await me.json()).session).toEqual({ signedIn: true, signOutUrl: '/replays/auth/logout' });
    expect((await signIn(undefined, '//evil.example')).callback.headers.get('location')).toBe('/replays/');
  });

  it('logs out by clearing the session and returning to the app root', async () => {
    const { signIn, get } = await start();
    const { session } = await signIn();
    const out = await get('/auth/logout', { cookie: session });
    expect(out.status).toBe(302);
    expect(out.headers.get('location')).toBe('/');
    expect(out.headers.getSetCookie()[0]).toMatch(/^rk_session=; .*Max-Age=0/);
  });
});

describe('callback checks', () => {
  it('rejects a callback whose state does not match the login cookie', async () => {
    const { get, signIn } = await start();
    const first = await signIn();
    const second = await signIn();
    // First login's cookie with the second login's state (and a valid code for it).
    const cross = await get(`/auth/callback?code=${second.code}&state=${second.params.get('state')}`, { cookie: first.loginCookie });
    expect(cross.status).toBe(400);
    expect(await cross.text()).toMatch(/sign-in failed/);
    expect(cross.headers.getSetCookie().some((line) => line.startsWith('rk_session='))).toBe(false);
    const forged = await get(`/auth/callback?code=x&state=forged`, { cookie: first.loginCookie });
    expect(forged.status).toBe(400);
  });

  it('rejects a callback without the login cookie, without a code, or with a tampered cookie', async () => {
    const { get, idp } = await start();
    const login = await get('/auth/login');
    const authorizeUrl = login.headers.get('location')!;
    const state = new URL(authorizeUrl).searchParams.get('state');
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
    const code = idp.authorize(authorizeUrl, { sub: 'u', email: 'ada@example.com' });
    expect((await get(`/auth/callback?code=${code}&state=${state}`)).status).toBe(400);
    expect((await get(`/auth/callback?state=${state}`, { cookie })).status).toBe(400);
    // Change the signed payload but keep the old signature.
    const [body, mac] = cookie.slice('rk_login='.length).split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString()) as Record<string, unknown>;
    const tampered = `rk_login=${b64(JSON.stringify({ ...payload, next: 'https://evil.example/' }))}.${mac}`;
    expect((await get(`/auth/callback?code=${code}&state=${state}`, { cookie: tampered })).status).toBe(400);
    expect((await get(`/auth/callback?code=${code}&state=${state}`, { cookie: 'rk_login=garbage' })).status).toBe(400);
    // And it still works with the genuine cookie.
    expect((await get(`/auth/callback?code=${code}&state=${state}`, { cookie })).status).toBe(302);
  });

  it('rejects an expired login attempt', async () => {
    const { get, idp, clock } = await start();
    const login = await get('/auth/login');
    const authorizeUrl = login.headers.get('location')!;
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
    const code = idp.authorize(authorizeUrl, { sub: 'u' });
    clock.now += 11 * 60_000;
    const callback = await get(`/auth/callback?code=${code}&state=${new URL(authorizeUrl).searchParams.get('state')}`, { cookie });
    expect(callback.status).toBe(400);
  });

  it('refuses the sign-in when the id token carries a different nonce', async () => {
    const { signIn, idp } = await start();
    idp.state.nonceOverride = 'nonce-from-another-login';
    const { callback } = await signIn();
    expect(callback.status).toBe(403);
    expect(await callback.text()).toBe('sign-in refused');
    expect(callback.headers.getSetCookie().some((line) => line.startsWith('rk_session=') && !line.includes('Max-Age=0'))).toBe(false);
  });

  it('refuses the sign-in when the id token is meant for another client', async () => {
    const { signIn, idp } = await start();
    idp.state.audience = 'some-other-client';
    expect((await signIn()).callback.status).toBe(403);
  });

  it('refuses the sign-in when the provider rejects the code exchange, and a replayed code', async () => {
    const { signIn, idp, get } = await start();
    const first = await signIn();
    expect(first.callback.status).toBe(302);
    // The provider already used this code; the second exchange fails.
    const replayed = await get(`/auth/callback?code=${first.code}&state=${first.params.get('state')}`, { cookie: first.loginCookie });
    expect(replayed.status).toBe(403);
    idp.state.tokenStatus = 500;
    expect((await signIn()).callback.status).toBe(403);
  });

  it('applies the allow list to the signed-in email', async () => {
    const { signIn, get } = await start({ allow: ['@example.com', 'grace@other.test'] });
    expect((await signIn({ sub: '1', email: 'ada@example.com' })).callback.status).toBe(302);
    expect((await signIn({ sub: '2', email: 'Grace@Other.test' })).callback.status).toBe(302);
    const refused = await signIn({ sub: '3', email: 'eve@evil.test' });
    expect(refused.callback.status).toBe(403);
    expect(refused.session).toBe('');
    // No email at all cannot satisfy an allow list.
    expect((await signIn({ sub: '4' })).callback.status).toBe(403);
    expect((await get('/api/me', { cookie: refused.session })).status).toBe(401);
  });
});

describe('session cookie', () => {
  it('rejects a tampered cookie: changed identity, changed signature, signed with another secret', async () => {
    const { signIn, get } = await start();
    const { session } = await signIn();
    const value = session.slice('rk_session='.length);
    const [body, mac] = value.split('.');
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString()) as Record<string, unknown>;

    expect((await get('/api/me', { cookie: session })).status).toBe(200);
    const swapped = `rk_session=${b64(JSON.stringify({ ...claims, id: 'admin@example.com', email: 'admin@example.com' }))}.${mac}`;
    expect((await get('/api/me', { cookie: swapped })).status).toBe(401);
    const flipped = `rk_session=${body}.${mac!.slice(0, -2)}${mac!.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await get('/api/me', { cookie: flipped })).status).toBe(401);
    const forgedBody = b64(JSON.stringify({ ...claims, id: 'eve@example.com', exp: Date.now() / 1000 + 3600 }));
    const forgedMac = b64(createHmac('sha256', 'not-the-session-secret-at-all').update(forgedBody).digest());
    expect((await get('/api/me', { cookie: `rk_session=${forgedBody}.${forgedMac}` })).status).toBe(401);
    for (const junk of ['rk_session=', 'rk_session=abc', 'rk_session=a.b.c', 'rk_session=.']) {
      expect((await get('/api/me', { cookie: junk })).status).toBe(401);
    }
  });

  it('rejects an expired session', async () => {
    const { signIn, get, clock } = await start();
    const { session } = await signIn();
    clock.now += 11 * 3600_000;
    expect((await get('/api/me', { cookie: session })).status).toBe(200);
    clock.now += 2 * 3600_000;
    expect((await get('/api/me', { cookie: session })).status).toBe(401);
    // A browser is sent back to sign in.
    const page = await get('/r/abc', { cookie: session, accept: 'text/html' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/auth/login?next=%2Fr%2Fabc');
  });

  it('honours a shorter session length', async () => {
    const { signIn, get, clock } = await start({ sessionHours: 1 });
    const { session, callback } = await signIn();
    expect(callback.headers.getSetCookie().find((line) => line.startsWith('rk_session='))).toContain('Max-Age=3600');
    clock.now += 61 * 60_000;
    expect((await get('/api/me', { cookie: session })).status).toBe(401);
  });

  // Source bug (src/server/auth/oidc.ts, authenticate): the login cookie is signed with the session secret and has
  // no `id`, yet it is accepted as a session, and /auth/login hands one to anyone. Remove `.fails` once fixed.
  it('does not accept the login cookie as a session', async () => {
    const { get } = await start();
    const login = await get('/auth/login');
    const loginCookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
    const value = loginCookie.slice('rk_login='.length);
    expect((await get('/api/me', { cookie: `rk_session=${value}` })).status).toBe(401);
  });
});

describe('bearer tokens for machine uploads', () => {
  it('accepts a token from the provider with the right issuer and audience', async () => {
    const { idp, origin, get } = await start();
    const token = mint(bearerClaims(idp.issuer, { email: 'ci@example.com' }));
    const me = await get('/api/me', { authorization: `Bearer ${token}` });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ id: 'ci@example.com', email: 'ci@example.com', session: { signedIn: true, signOutUrl: '/auth/logout' } });
    const uploaded = await upload(origin, token);
    expect(uploaded.status).toBe(201);
    expect((await get('/api/replays/machine-upload', { authorization: `Bearer ${token}` })).status).toBe(200);
    // Without the token, the stored replay stays private.
    expect((await get('/api/replays/machine-upload')).status).toBe(401);
  });

  it('identifies a service account by its subject when there is no email', async () => {
    const { idp, get } = await start();
    const me = await get('/api/me', { authorization: `Bearer ${mint(bearerClaims(idp.issuer))}` });
    expect(await me.json()).toEqual({ id: 'ci-bot', session: { signedIn: true, signOutUrl: '/auth/logout' } });
  });

  it('checks the audience against the configured API audience instead of the client id', async () => {
    const { idp, get } = await start({ audience: 'replays-api' });
    const wanted = mint(bearerClaims(idp.issuer, { aud: ['other', 'replays-api'] }));
    expect((await get('/api/me', { authorization: `Bearer ${wanted}` })).status).toBe(200);
    const clientToken = mint(bearerClaims(idp.issuer));
    expect((await get('/api/me', { authorization: `Bearer ${clientToken}` })).status).toBe(401);
  });

  it('rejects tokens with the wrong audience, issuer or time window', async () => {
    const { idp, get, origin } = await start();
    const now = Date.parse('2026-10-14T10:00:00.000Z') / 1000;
    const cases: Array<[string, Record<string, unknown>]> = [
      ['wrong audience', { aud: 'someone-else' }],
      ['no audience', { aud: undefined }],
      ['wrong issuer', { iss: 'https://evil.example.test' }],
      ['expired', { iat: now - 7200, exp: now - 3600 }],
      ['no expiry', { exp: undefined }],
      ['not yet valid', { nbf: now + 3600 }],
      ['issued in the future', { iat: now + 3600, exp: now + 7200 }],
    ];
    for (const [, extra] of cases) {
      const token = mint(bearerClaims(idp.issuer, extra, now));
      expect((await get('/api/me', { authorization: `Bearer ${token}` })).status).toBe(401);
      expect((await upload(origin, token, 'refused-upload')).status).toBe(401);
    }
    expect((await get('/api/replays/refused-upload', { authorization: `Bearer ${mint(bearerClaims(idp.issuer))}` })).status).toBe(404);
  });

  it('rejects forged tokens: another key, an unknown key id, alg none, HS256, a changed payload, junk', async () => {
    const { idp, get } = await start();
    const claims = bearerClaims(idp.issuer, { email: 'ci@example.com' });
    const good = mint(claims);
    expect((await get('/api/me', { authorization: `Bearer ${good}` })).status).toBe(200);
    const [head, , signature] = good.split('.');
    const swapped = `${head}.${b64(JSON.stringify({ ...claims, email: 'admin@example.com' }))}.${signature}`;
    const hmac = `${b64(JSON.stringify({ alg: 'HS256', kid: 'test-key' }))}.${b64(JSON.stringify(claims))}.${b64(createHmac('sha256', 'x').update('y').digest())}`;
    for (const [, token] of [
      ['signed with another key', mint(claims, { key: otherKey })],
      ['unknown kid', mint(claims, { kid: 'rotated-away' })],
      ['alg none', mint(claims, { alg: 'none' })],
      ['HS256', hmac],
      ['payload changed after signing', swapped],
      ['two parts', good.split('.').slice(0, 2).join('.')],
      ['four parts', `${good}.extra`],
      ['junk', 'not-a-token'],
    ] as const) {
      expect((await get('/api/me', { authorization: `Bearer ${token}` }))?.status).toBe(401);
    }
    // Not a Bearer header at all.
    expect((await get('/api/me', { authorization: `Basic ${b64('user:pass')}` })).status).toBe(401);
  });

  it('applies the allow list to bearer identities too', async () => {
    const { idp, get } = await start({ allow: ['ci@example.com'] });
    const ok = mint(bearerClaims(idp.issuer, { email: 'ci@example.com' }));
    const other = mint(bearerClaims(idp.issuer, { email: 'eve@evil.test' }));
    expect((await get('/api/me', { authorization: `Bearer ${ok}` })).status).toBe(200);
    expect((await get('/api/me', { authorization: `Bearer ${other}` })).status).toBe(401);
  });
});

describe('discovery', () => {
  it('fails closed when the provider names a different issuer than the configured one', async () => {
    const { idp, get } = await start();
    idp.state.issuerInDiscovery = 'https://another-issuer.example.test';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const login = await get('/auth/login');
    expect(login.status).toBeGreaterThanOrEqual(400);
    expect(login.headers.get('set-cookie')).toBeNull();
    expect(login.headers.get('location')).toBeNull();
    const token = mint(bearerClaims(idp.issuer));
    expect((await get('/api/me', { authorization: `Bearer ${token}` })).status).toBeGreaterThanOrEqual(400);
  });
});
