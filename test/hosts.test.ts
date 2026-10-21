import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { hostBase, hostName, hostVary, normalizeHosts, requestHost } from '../src/server/base-path.ts';
import { loadSettings, readConfigFile } from '../src/server/config.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const INDEX = `<!doctype html><html><head><meta name="app-base" content="" /><title>__PRODUCT_NAME__</title><script type="module" src="./assets/main.js"></script></head></html>`;

async function start(options: Partial<Parameters<typeof createApp>[0]>) {
  const root = await mkdtemp(join(tmpdir(), 'replays-hosts-'));
  const clientDir = join(root, 'client');
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await writeFile(join(clientDir, 'index.html'), INDEX);
  await writeFile(join(clientDir, 'assets', 'main.js'), 'console.log(1)');
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const handle = createApp({ ...appDefaults(), store, clientDir, ...options });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

/** A request with an explicit `Host` (fetch cannot set one). */
function call(port: number, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (text += chunk));
      response.on('end', () => done({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
    });
    request.on('error', fail);
    request.end(body);
  });
}

const page = { accept: 'text/html' };

describe('host names', () => {
  it('drops the port, case and a trailing dot', () => {
    expect(hostName('Replays.Example.COM:8443')).toBe('replays.example.com');
    expect(hostName('replays.example.com.')).toBe('replays.example.com');
    expect(hostName('[::1]:8080')).toBe('[::1]');
    expect(hostName(undefined)).toBe('');
  });

  it('reads Host, or the last X-Forwarded-Host value only when trusted', () => {
    const headers = { host: 'internal:8080', 'x-forwarded-host': 'spoofed.example, replays.example.com' };
    expect(requestHost(headers, false)).toBe('internal');
    expect(requestHost(headers, true)).toBe('replays.example.com');
    expect(requestHost({ host: 'a.example' }, true)).toBe('a.example');
    expect(requestHost({ host: 'a.example', 'x-forwarded-host': ['b.example', 'c.example'] }, true)).toBe('c.example');
  });
});

describe('normalizeHosts', () => {
  it('normalizes names and bases', () => {
    const routing = normalizeHosts({ 'Replays.Example.com': { basePath: '/' }, 'tools.example.com': { basePath: '/replays/' } });
    expect([...routing.bases]).toEqual([
      ['replays.example.com', ''],
      ['tools.example.com', '/replays'],
    ]);
    expect(routing.trustForwardedHost).toBe(false);
    expect(normalizeHosts(undefined, true)).toEqual({ bases: new Map(), trustForwardedHost: true });
  });

  it('rejects anything that is not a plain host name with a valid base', () => {
    for (const bad of ['https://a.example', 'a.example:8080', '*.example.com', 'a.example/x', '', '-a.example', 'a..example'])
      expect(() => normalizeHosts({ [bad]: { basePath: '/' } })).toThrow(/not a host name/);
    expect(() => normalizeHosts({ 'A.example': { basePath: '/' }, 'a.example': { basePath: '/x' } })).toThrow(/twice/);
    expect(() => normalizeHosts({ 'a.example': { basePath: 'x' } })).toThrow(/basePath must be/);
    expect(() => normalizeHosts({ 'a.example': { basePath: '/a/../b' } })).toThrow(/basePath must be/);
    expect(() => normalizeHosts({ 'a.example': '/' })).toThrow(/must be \{ basePath/);
    expect(() => normalizeHosts({ 'a.example': { basePath: '/', name: 'x' } })).toThrow(/unknown keys: name/);
    expect(() => normalizeHosts(['a.example'])).toThrow(/must be an object/);
  });

  it('picks the base by host, else the default; Vary only with entries', () => {
    const routing = normalizeHosts({ 'replays.example.com': { basePath: '/' } });
    expect(hostBase({ host: 'replays.example.com:443' }, routing, '/replays')).toBe('');
    expect(hostBase({ host: 'other.example' }, routing, '/replays')).toBe('/replays');
    expect(hostBase({}, routing, '/replays')).toBe('/replays');
    expect(hostBase({ host: 'replays.example.com' }, undefined, '/replays')).toBe('/replays');
    expect(hostVary(routing)).toBe('Host');
    expect(hostVary(normalizeHosts({ 'a.example': { basePath: '/' } }, true))).toBe('Host, X-Forwarded-Host');
    expect(hostVary(normalizeHosts({}))).toBeUndefined();
    expect(hostVary(undefined)).toBeUndefined();
  });
});

describe('hosts in the settings', () => {
  it('reads hosts and trustForwardedHost from the file; TRUST_FORWARDED_HOST wins', async () => {
    const file = { hosts: { 'replays.example.com': { basePath: '/' } }, trustForwardedHost: true, basePath: '/replays' };
    const settings = await loadSettings({}, file);
    expect(settings.basePath).toBe('/replays');
    expect([...settings.hosts.bases]).toEqual([['replays.example.com', '']]);
    expect(settings.hosts.trustForwardedHost).toBe(true);
    expect((await loadSettings({ TRUST_FORWARDED_HOST: 'false' }, file)).hosts.trustForwardedHost).toBe(false);
    expect((await loadSettings({ TRUST_FORWARDED_HOST: '1' }, {})).hosts.trustForwardedHost).toBe(true);
    expect((await loadSettings({}, {})).hosts).toEqual({ bases: new Map(), trustForwardedHost: false });
  });

  it('fails at start on a bad host, base or flag', async () => {
    await expect(loadSettings({}, { hosts: { 'a.example:80': { basePath: '/' } } })).rejects.toThrow(/not a host name/);
    await expect(loadSettings({ TRUST_FORWARDED_HOST: 'maybe' }, {})).rejects.toThrow(/TRUST_FORWARDED_HOST must be true or false/);
    await expect(loadSettings({}, { trustForwardedHost: 'yes' as never })).rejects.toThrow(/trustForwardedHost must be true or false/);
  });

  it('accepts the keys in a JSON config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-hosts-config-'));
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ hosts: { 'a.example': { basePath: '/' } }, trustForwardedHost: false }));
    expect(await readConfigFile(path)).toMatchObject({ hosts: { 'a.example': { basePath: '/' } } });
  });
});

describe('one process, a base per host', () => {
  const options = { basePath: '/replays', hosts: { 'replays.example.com': { basePath: '/' } } };

  it('serves index.html at each host’s base, with Vary: Host', async () => {
    const port = await start(options);
    const root = await call(port, '/r/test-replay', { ...page, host: 'replays.example.com' });
    expect(root.status).toBe(200);
    expect(root.body).toContain('<meta name="app-base" content="/" />');
    expect(root.body).toContain('src="/assets/main.js"');
    expect(String(root.headers.vary)).toMatch(/\bHost\b/);

    const prefixed = await call(port, '/replays/r/test-replay', { ...page, host: 'tools.example.com' });
    expect(prefixed.status).toBe(200);
    expect(prefixed.body).toContain('<meta name="app-base" content="/replays" />');
    expect(prefixed.body).toContain('src="/replays/assets/main.js"');
    expect(String(prefixed.headers.vary)).toMatch(/\bHost\b/);
    // Revalidation keeps the Vary.
    const etag = String(prefixed.headers.etag);
    const cached = await call(port, '/replays/r/test-replay', { ...page, host: 'tools.example.com', 'if-none-match': etag });
    expect(cached.status).toBe(304);
    expect(String(cached.headers.vary)).toMatch(/\bHost\b/);
  });

  it('routes the API at each base and writes receipts for the asking host', async () => {
    const port = await start(options);
    const config = await call(port, '/api/config', { host: 'replays.example.com' });
    expect(config.status).toBe(200);
    expect(String(config.headers.vary)).toMatch(/\bHost\b/);
    expect((await call(port, '/replays/api/config', { host: 'tools.example.com' })).status).toBe(200);

    const upload = (host: string, path: string, id: string) =>
      call(port, path, { host, 'content-type': 'application/json' }, JSON.stringify(replay(id)));
    const atRoot = await upload('replays.example.com', '/api/replays', 'via-root');
    expect(atRoot.status).toBe(201);
    expect(JSON.parse(atRoot.body)).toEqual({ id: 'via-root', url: '/r/via-root' });
    expect(String(atRoot.headers.vary)).toMatch(/\bHost\b/);
    const prefixed = await upload('tools.example.com', '/replays/api/replays', 'via-prefix');
    expect(JSON.parse(prefixed.body)).toEqual({ id: 'via-prefix', url: '/replays/r/via-prefix' });
  });

  it('redirects to sign-in with Vary: Host', async () => {
    const auth = {
      name: 'test',
      authenticate: async () => undefined,
      loginUrl: (_request: unknown, context: { base: string }) => `${context.base}/login`,
    };
    const port = await start({ ...options, auth });
    const root = await call(port, '/', { ...page, host: 'replays.example.com' });
    expect([root.status, root.headers.location]).toEqual([302, '/login']);
    expect(String(root.headers.vary)).toMatch(/\bHost\b/);
    const prefixed = await call(port, '/replays/', { ...page, host: 'tools.example.com' });
    expect([prefixed.status, prefixed.headers.location]).toEqual([302, '/replays/login']);
  });

  it('reads X-Forwarded-Host only when trusted', async () => {
    const forwarded = { ...page, host: 'internal.example', 'x-forwarded-host': 'replays.example.com' };
    const untrusted = await start(options);
    const ignored = await call(untrusted, '/replays/', forwarded);
    expect(ignored.body).toContain('<meta name="app-base" content="/replays" />');

    const trusted = await start({ ...options, trustForwardedHost: true });
    const used = await call(trusted, '/', forwarded);
    expect(used.body).toContain('<meta name="app-base" content="/" />');
    expect(String(used.headers.vary)).toMatch(/Host, X-Forwarded-Host/);
  });

  it('takes the checked routing from loadSettings too', async () => {
    const settings = await loadSettings({}, { basePath: '/replays', hosts: { 'replays.example.com': { basePath: '/' } } });
    const port = await start({ basePath: settings.basePath, hosts: settings.hosts });
    expect((await call(port, '/', { ...page, host: 'replays.example.com' })).body).toContain('content="/"');
  });

  it('adds no Vary: Host without hosts', async () => {
    const port = await start({ basePath: '/replays' });
    const response = await call(port, '/replays/', { ...page, host: 'replays.example.com' });
    expect(response.body).toContain('<meta name="app-base" content="/replays" />');
    expect(String(response.headers.vary)).not.toMatch(/\bHost\b/);
    expect((await call(port, '/replays/api/config', { host: 'x.example' })).headers.vary).toBeUndefined();
  });
});
