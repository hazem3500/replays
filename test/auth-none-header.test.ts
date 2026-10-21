import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { authFromEnv, headerAuth, noneAuth } from '../src/server/auth/index.ts';
import { addressMatches } from '../src/server/auth/header.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { ReplayStore } from '../src/server/store.ts';
import { describeAuthAdapter } from '../src/server/testing/index.ts';
import { appDefaults } from './fixtures.ts';

/** The two things an adapter reads from a request: its headers and the peer address. */
const request = (headers: Record<string, string | string[]> = {}, remoteAddress?: string) =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

const proxied = (headers: Record<string, string | string[]>, remoteAddress = '10.0.0.5') => request(headers, remoteAddress);

describe('none adapter', () => {
  it('treats every request as the same anonymous user', async () => {
    const auth = noneAuth({});
    expect(auth.name).toBe('none');
    expect(await auth.authenticate(request())).toEqual({ id: 'anonymous' });
    expect(auth.routes).toBeUndefined();
    expect(auth.loginUrl).toBeUndefined();
  });

  it('uses DEV_USER as the default name, and an email as the email too', async () => {
    expect(await noneAuth({ DEV_USER: 'Tester' }).authenticate(request())).toEqual({ id: 'Tester' });
    expect(await noneAuth({ DEV_USER: ' ada@example.com ' }).authenticate(request())).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
    });
    expect(await noneAuth({ DEV_USER: '   ' }).authenticate(request())).toEqual({ id: 'anonymous' });
  });

  it('lets x-dev-user override the name per request, bounded to 200 characters', async () => {
    const auth = noneAuth({ DEV_USER: 'fallback' });
    expect(await auth.authenticate(request({ 'x-dev-user': 'ada@example.com' }))).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
    });
    expect(await auth.authenticate(request({ 'x-dev-user': '   ' }))).toEqual({ id: 'fallback' });
    const long = await auth.authenticate(request({ 'x-dev-user': 'x'.repeat(500) }));
    expect(long?.id).toHaveLength(200);
  });
});

describe('addressMatches', () => {
  it('matches exact addresses, including the IPv4-mapped IPv6 form', () => {
    expect(addressMatches('10.0.0.5', '10.0.0.5')).toBe(true);
    expect(addressMatches('::ffff:10.0.0.5', '10.0.0.5')).toBe(true);
    expect(addressMatches('::1', '::1')).toBe(true);
    expect(addressMatches('10.0.0.6', '10.0.0.5')).toBe(false);
    expect(addressMatches(undefined, '10.0.0.5')).toBe(false);
  });

  it('matches IPv4 CIDR ranges at the boundaries', () => {
    expect(addressMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(addressMatches('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(addressMatches('192.168.1.1', '192.168.1.0/24')).toBe(true);
    expect(addressMatches('192.168.2.1', '192.168.1.0/24')).toBe(false);
    expect(addressMatches('172.16.0.1', '172.16.0.0/12')).toBe(true);
    expect(addressMatches('172.32.0.1', '172.16.0.0/12')).toBe(false);
    expect(addressMatches('::ffff:192.168.1.9', '192.168.1.0/24')).toBe(true);
    expect(addressMatches('203.0.113.9', '0.0.0.0/0')).toBe(true);
    expect(addressMatches('203.0.113.9', '203.0.113.9/32')).toBe(true);
    expect(addressMatches('203.0.113.10', '203.0.113.9/32')).toBe(false);
  });

  it('refuses malformed ranges and non-IPv4 peers instead of matching them', () => {
    expect(addressMatches('10.0.0.1', '10.0.0.0/33')).toBe(false);
    expect(addressMatches('10.0.0.1', '10.0.0.0/-1')).toBe(false);
    expect(addressMatches('10.0.0.1', '10.0.0.0/x')).toBe(false);
    expect(addressMatches('10.0.0.1', 'proxy.example.com/8')).toBe(false);
    expect(addressMatches('fe80::1', '10.0.0.0/8')).toBe(false);
  });
});

describe('header adapter', () => {
  it('refuses to start without a header name or without trusted proxies', () => {
    expect(() => headerAuth({ header: '', trustedProxies: ['10.0.0.5'] })).toThrow(/header name/);
    expect(() => headerAuth({ header: 'x-forwarded-email', trustedProxies: [] })).toThrow(/AUTH_TRUSTED_PROXIES/);
  });

  it('reads the identity from the header when the peer is a trusted proxy', async () => {
    const auth = headerAuth({ header: 'X-Forwarded-Email', trustedProxies: ['10.0.0.5'] });
    expect(auth.name).toBe('header');
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': 'ada@example.com' }))).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
    });
    // A user name that is not an email has no email.
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': 'ada' }))).toEqual({ id: 'ada' });
    // Repeated headers: the first value counts.
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': ['ada@example.com', 'eve@example.com'] }))).toMatchObject({
      id: 'ada@example.com',
    });
  });

  it('adds a display name from the optional name header, bounded', async () => {
    const auth = headerAuth({ header: 'x-forwarded-email', nameHeader: 'X-Forwarded-User', trustedProxies: ['10.0.0.5'] });
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': 'ada@example.com', 'x-forwarded-user': 'Ada Example' }))).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Example',
    });
    const long = await auth.authenticate(proxied({ 'x-forwarded-email': 'ada@example.com', 'x-forwarded-user': 'n'.repeat(400) }));
    expect(long?.name).toHaveLength(120);
  });

  it('refuses a request from a peer that is not a trusted proxy, even with the header', async () => {
    const auth = headerAuth({ header: 'x-forwarded-email', trustedProxies: ['10.0.0.5', '192.168.0.0/16'] });
    const forged = { 'x-forwarded-email': 'admin@example.com' };
    expect(await auth.authenticate(proxied(forged, '203.0.113.7'))).toBeUndefined();
    expect(await auth.authenticate(proxied(forged, '10.0.0.6'))).toBeUndefined();
    expect(await auth.authenticate(request(forged, undefined))).toBeUndefined();
    // Trusted by exact address, by CIDR, and in its IPv4-mapped IPv6 form.
    expect(await auth.authenticate(proxied(forged, '10.0.0.5'))).toBeDefined();
    expect(await auth.authenticate(proxied(forged, '192.168.44.2'))).toBeDefined();
    expect(await auth.authenticate(proxied(forged, '::ffff:192.168.44.2'))).toBeDefined();
  });

  it('refuses a trusted request without the header, with an empty one, or with an oversized one', async () => {
    const auth = headerAuth({ header: 'x-forwarded-email', trustedProxies: ['10.0.0.5'] });
    expect(await auth.authenticate(proxied({}))).toBeUndefined();
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': '   ' }))).toBeUndefined();
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': `${'a'.repeat(300)}@example.com` }))).toBeUndefined();
  });

  it('applies the allow list: exact identities and @domain suffixes, case-insensitively', async () => {
    const auth = headerAuth({
      header: 'x-forwarded-email',
      trustedProxies: ['10.0.0.5'],
      allow: ['Ada@Example.com', '@team.example.org'],
    });
    const who = (id: string) => auth.authenticate(proxied({ 'x-forwarded-email': id }));
    expect(await who('ada@example.com')).toBeDefined();
    expect(await who('ADA@EXAMPLE.COM')).toBeDefined();
    expect(await who('grace@team.example.org')).toBeDefined();
    expect(await who('grace@TEAM.EXAMPLE.ORG')).toBeDefined();
    expect(await who('eve@example.com')).toBeUndefined();
    expect(await who('grace@evil-team.example.org')).toBeUndefined();
    expect(await who('grace@team.example.org.evil.test')).toBeUndefined();
  });

  it('an empty allow list admits every identity the proxy vouches for', async () => {
    const auth = headerAuth({ header: 'x-forwarded-email', trustedProxies: ['10.0.0.5'], allow: [] });
    expect(await auth.authenticate(proxied({ 'x-forwarded-email': 'anyone@example.com' }))).toBeDefined();
  });
});

describe('header and none adapters from the environment', () => {
  it('builds none by default and header from AUTH_* variables', async () => {
    expect((await authFromEnv({})).name).toBe('none');
    expect((await authFromEnv({ AUTH_MODE: ' None ' })).name).toBe('none');
    const auth = await authFromEnv({
      AUTH_MODE: 'header',
      AUTH_HEADER: 'x-forwarded-email',
      AUTH_NAME_HEADER: 'x-forwarded-user',
      AUTH_TRUSTED_PROXIES: '10.0.0.5, 192.168.0.0/16',
      AUTH_ALLOW: '@example.com',
    });
    expect(auth.name).toBe('header');
    const headers = { 'x-forwarded-email': 'ada@example.com', 'x-forwarded-user': 'Ada Example' };
    expect(await auth.authenticate(request(headers, '192.168.1.1'))).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Example',
    });
    expect(await auth.authenticate(request(headers, '8.8.8.8'))).toBeUndefined();
    expect(await auth.authenticate(request({ 'x-forwarded-email': 'eve@other.test' }, '10.0.0.5'))).toBeUndefined();
  });

  it('names the missing variable and rejects an unknown mode', async () => {
    await expect(authFromEnv({ AUTH_MODE: 'header' })).rejects.toThrow(/AUTH_MODE=header needs AUTH_HEADER/);
    await expect(authFromEnv({ AUTH_MODE: 'header', AUTH_HEADER: 'x-user' })).rejects.toThrow(/AUTH_TRUSTED_PROXIES/);
    await expect(authFromEnv({ AUTH_MODE: 'oidc' })).rejects.toThrow(/AUTH_MODE=oidc needs OIDC_ISSUER/);
    await expect(authFromEnv({ AUTH_MODE: 'plugin' })).rejects.toThrow(/AUTH_MODE=plugin needs AUTH_PLUGIN/);
    await expect(authFromEnv({ AUTH_MODE: 'basic' })).rejects.toThrow(/AUTH_MODE must be none, header, oidc or plugin/);
  });
});

describe('adapters behind createApp', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function start(auth: AuthAdapter) {
    const root = await mkdtemp(join(tmpdir(), 'replays-auth-'));
    const handle = createApp({
      ...appDefaults(),
      auth,
      store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
      clientDir: join(root, 'client'),
    });
    const server = createServer((req, res) => void handle(req, res));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  }

  it('answers /api/me with the none adapter identity', async () => {
    const origin = await start(noneAuth({ DEV_USER: 'dev@example.com' }));
    expect(await (await fetch(`${origin}/api/me`)).json()).toEqual({ id: 'dev@example.com', email: 'dev@example.com' });
    expect(await (await fetch(`${origin}/api/me`, { headers: { 'x-dev-user': 'ada@example.com' } })).json()).toMatchObject({
      id: 'ada@example.com',
    });
  });

  it('the header adapter trusts the loopback peer only when it is listed', async () => {
    const trusted = await start(
      headerAuth({ header: 'x-forwarded-email', nameHeader: 'x-forwarded-user', trustedProxies: ['127.0.0.0/8'] }),
    );
    const headers = { 'x-forwarded-email': 'ada@example.com', 'x-forwarded-user': 'Ada Example' };
    expect(await (await fetch(`${trusted}/api/me`, { headers })).json()).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Example',
    });
    // No header: signed out, and this adapter has no sign-in page, so the answer is a plain refusal.
    expect((await fetch(`${trusted}/api/me`)).status).toBe(403);

    const untrusted = await start(headerAuth({ header: 'x-forwarded-email', trustedProxies: ['203.0.113.0/24'] }));
    expect((await fetch(`${untrusted}/api/me`, { headers })).status).toBe(403);
    expect((await fetch(`${untrusted}/api/replays`, { headers })).status).toBe(403);
    // The health check never needs an identity.
    expect(await (await fetch(`${untrusted}/healthz`)).text()).toBe('ok');
  });
});

// The built-ins pass the same contract a third-party adapter runs (`@hazem3500/replays/server/testing`).
describeAuthAdapter(
  'none',
  {
    create: () => noneAuth({ DEV_USER: 'dev@example.com' }),
    accepts: [
      { title: 'any request, as DEV_USER', request: {}, id: 'dev@example.com' },
      { title: 'x-dev-user', request: { headers: { 'x-dev-user': 'ada@example.com' } }, id: 'ada@example.com' },
    ],
    refuses: [],
  },
  { describe, it },
);
describeAuthAdapter(
  'header',
  {
    create: () => headerAuth({ header: 'x-forwarded-email', trustedProxies: ['10.0.0.0/8'], allow: ['@example.com'] }),
    accepts: [
      {
        title: 'the header from a trusted proxy',
        request: { headers: { 'x-forwarded-email': 'ada@example.com' }, remoteAddress: '10.0.0.5' },
        id: 'ada@example.com',
      },
    ],
    refuses: [
      {
        title: 'the header from another peer',
        request: { headers: { 'x-forwarded-email': 'ada@example.com' }, remoteAddress: '192.0.2.1' },
      },
      { title: 'no header', request: { remoteAddress: '10.0.0.5' } },
      {
        title: 'an identity outside the allow-list',
        request: { headers: { 'x-forwarded-email': 'eve@evil.test' }, remoteAddress: '10.0.0.5' },
      },
    ],
  },
  { describe, it },
);
