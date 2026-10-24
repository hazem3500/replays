import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  definePlugin,
  mergeRegistries,
  resolvePlugins,
  type PluginApi,
  type PrepareUploadHook,
  type RequestHook,
  type RequestPolicy,
} from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const trusted = 'https://app.example.com';
const policy: RequestPolicy = { path: '/api/replays', methods: ['POST'], origins: [trusted], headers: ['content-type'], credentials: true };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function start(setup: (api: PluginApi) => void, basePath = '', overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replays-intake-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'samples'));
  const authenticate = vi.fn<(request: IncomingMessage) => { id: string } | undefined>((request) =>
    request.headers.authorization === 'Bearer trusted' ? { id: 'service-account' } : undefined,
  );
  const registry = await resolvePlugins([definePlugin({ name: 'host', setup })]);
  const handle = createApp({
    ...appDefaults(),
    auth: { name: 'verified', authenticate },
    store,
    clientDir: root,
    plugins: registry,
    basePath,
    ...overrides,
  });
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${address.port}`;
  return { store, authenticate, origin, request: (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init) };
}
const upload = (body: unknown = replay(), extra: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { authorization: 'Bearer trusted', 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
});
const crossSite = { origin: trusted, 'sec-fetch-site': 'cross-site' };
const preflight = (extra: Record<string, string> = {}): RequestInit => ({
  method: 'OPTIONS',
  headers: { origin: trusted, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type', ...extra },
});

function expectCors(response: Response) {
  expect(response.headers.get('access-control-allow-origin')).toBe(trusted);
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  expect(response.headers.get('vary')).toContain('Origin');
}

describe('trusted request policy', () => {
  it('answers preflight before auth or request hooks, without reading credentials, body or storage', async () => {
    const hook = vi.fn<RequestHook>();
    const { request, authenticate, store } = await start((api) => {
      api.requestPolicy(policy);
      api.onRequest(hook, { phase: 'pre-auth' });
    });
    const list = vi.spyOn(store, 'list');
    const response = await request('/api/replays', preflight());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expectCors(response);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(response.headers.get('vary')?.split(', ')).toEqual([
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ]);
    expect(authenticate).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://unknown.example.com' },
    { origin: 'null' },
    { origin: `${trusted}/` },
    { 'access-control-request-method': 'PUT' },
    { 'access-control-request-method': 'post' },
    { 'access-control-request-headers': 'content-type, authorization' },
    { 'access-control-request-headers': '*' },
    { 'access-control-request-headers': 'content-type,' },
  ])('denies preflight outside the exact allowlist: %j', async (headers) => {
    const { request, authenticate } = await start((api) => api.requestPolicy(policy));
    const response = await request('/api/replays', preflight(headers));
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toContain('Access-Control-Request-Headers');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('requires origin and requested method; permits preflight without requested headers', async () => {
    const { request } = await start((api) => api.requestPolicy(policy));
    expect((await request('/api/replays', { method: 'OPTIONS' })).status).toBe(403);
    expect((await request('/api/replays', { method: 'OPTIONS', headers: { origin: trusted } })).status).toBe(403);
    expect(
      (await request('/api/replays', { method: 'OPTIONS', headers: { origin: trusted, 'access-control-request-method': 'POST' } })).status,
    ).toBe(204);
  });

  it('requires verified auth for data and retains CORS on auth, validation, duplicate and server errors', async () => {
    const { request, store, authenticate } = await start((api) => api.requestPolicy(policy));
    const denied = await request('/api/replays', upload(replay(), { ...crossSite, authorization: 'Bearer forged' }));
    expect(denied.status).toBe(403);
    expectCors(denied);
    expect(await store.load('test-replay')).toBeUndefined();
    const invalid = await request('/api/replays', upload({ bad: true }, crossSite));
    expect(invalid.status).toBe(400);
    expectCors(invalid);
    const accepted = await request('/api/replays', upload(replay(), crossSite));
    expect(accepted.status).toBe(201);
    expectCors(accepted);
    const duplicate = await request('/api/replays', upload(replay(), crossSite));
    expect(duplicate.status).toBe(409);
    expectCors(duplicate);
    vi.spyOn(store, 'save').mockRejectedValueOnce(Object.assign(new Error('private storage detail'), { status: 500 }));
    const failed = await request('/api/replays', upload(replay('failed-replay'), crossSite));
    expect(failed.status).toBe(500);
    expectCors(failed);
    expect(await failed.text()).not.toContain('private storage detail');
    expect(authenticate).toHaveBeenCalledTimes(5);
  });

  it('matches only exact origins, paths and methods; keeps reads and other routes unchanged', async () => {
    const hook = vi.fn<RequestHook>();
    const { request } = await start((api) => {
      api.requestPolicy(policy);
      api.onRequest(hook);
    });
    for (const origin of ['https://unknown.example.com', `${trusted}.evil.example`, 'null']) {
      const response = await request('/api/replays', upload(replay(), { origin }));
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    for (const path of ['/api/replays/', '/api/replays/import', '/api/suites']) {
      const response = await request(path, upload(replay(), crossSite));
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    const put = await request('/api/replays', { ...upload(replay(), crossSite), method: 'PUT' });
    expect(put.status).toBe(403);
    expect(put.headers.get('access-control-allow-origin')).toBeNull();
    const get = await request('/api/replays', { headers: { authorization: 'Bearer trusted', origin: trusted } });
    expect(get.status).toBe(200);
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1);
    const noOrigin = await request('/api/replays', upload(replay(), { 'sec-fetch-site': 'cross-site' }));
    expect(noOrigin.status).toBe(403);
    expect(
      (await request('/api/replays', upload(replay(), { origin: 'https://replays.example.com', 'sec-fetch-site': 'same-origin' }))).status,
    ).toBe(201);
    expect((await request('/api/replays', upload(replay('cli-upload')))).status).toBe(201);
  });

  it('respects mounted and proxy-stripped base paths and preserves host Vary fields', async () => {
    const { request } = await start((api) => {
      api.requestPolicy(policy);
      api.onRequest(({ response }) => {
        response.writeHead(418, { Vary: 'Accept-Encoding, Host' });
        response.end('host error');
        return true;
      });
    }, '/tools/replays');
    for (const path of ['/tools/replays/api/replays', '/api/replays']) {
      expect((await request(path, preflight())).status).toBe(204);
      const response = await request(`${path}?source=app`, upload(replay(), crossSite));
      expect(response.status).toBe(418);
      expectCors(response);
      expect(new Set(response.headers.get('vary')?.split(', '))).toEqual(new Set(['Accept-Encoding', 'Host', 'Origin']));
    }
  });
});

describe('host routing with intake policies', () => {
  it.each([false, true])(
    'preserves host routing Vary on refusals, preflights and compressed reads (forwarded=%s)',
    async (trustForwardedHost) => {
      const { request, store } = await start((api) => api.requestPolicy(policy), '', {
        hosts: { '127.0.0.1': { basePath: '/tools/replays' }, 'tools.example.com': { basePath: '/tools/replays' } },
        trustForwardedHost,
      });
      const hostHeaders = { 'x-forwarded-host': 'tools.example.com' };
      const hostFields = trustForwardedHost ? ['Host', 'X-Forwarded-Host'] : ['Host'];
      const expectVary = (response: Response, extra: string[]) =>
        expect(new Set(response.headers.get('vary')?.split(', '))).toEqual(new Set([...hostFields, 'Origin', ...extra]));
      const denied = await request(
        '/tools/replays/api/replays',
        upload(replay(), { ...hostHeaders, origin: 'https://unknown.example.com' }),
      );
      expect(denied.status).toBe(403);
      expectVary(denied, []);
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
      const unauthenticated = await request(
        '/tools/replays/api/replays',
        upload(replay(), { ...hostHeaders, ...crossSite, authorization: '' }),
      );
      expect(unauthenticated.status).toBe(403);
      expectCors(unauthenticated);
      expectVary(unauthenticated, []);
      for (const method of ['POST', 'PUT']) {
        const response = await request(
          '/tools/replays/api/replays',
          preflight({ ...hostHeaders, 'access-control-request-method': method }),
        );
        expect(response.status).toBe(method === 'POST' ? 204 : 403);
        expectVary(response, ['Access-Control-Request-Method', 'Access-Control-Request-Headers']);
      }
      for (let index = 0; index < 5; index++) {
        const bundle = replay(`compress-${index}`);
        bundle.meta.title = 'a meaningful test recording title '.repeat(10);
        await store.save(bundle);
      }
      const compressed = await request('/tools/replays/api/replays', {
        headers: { ...hostHeaders, authorization: 'Bearer trusted', origin: trusted, 'accept-encoding': 'gzip' },
      });
      expect(compressed.status).toBe(200);
      expect(compressed.headers.get('content-encoding')).toBe('gzip');
      expectVary(compressed, ['Accept-Encoding']);
      expect(compressed.headers.get('access-control-allow-origin')).toBeNull();
      expect(await compressed.json()).toHaveLength(5);
    },
  );
});

describe('upload endpoint aliases', () => {
  const path = '/api/foreign-recordings';
  it('runs endpoint prepare, global prepare, validation, privacy, upload hooks and immutable storage with the original URL', async () => {
    const calls: string[] = [];
    const { request, store } = await start((api) => {
      api.redaction({ queryParams: ['tenant-secret'] });
      api.uploadEndpoint({
        path,
        prepare: ({ body, request: incoming, identity }) => {
          calls.push(`alias:${identity.id}:${incoming.url}`);
          return (body as { recording: unknown }).recording;
        },
      });
      api.prepareUpload(({ body, request: incoming }) => {
        calls.push(`global:${incoming.url}`);
        return body;
      });
      api.beforeUpload(({ bundle }) => {
        calls.push('before');
        expect(bundle.meta.url).not.toContain('private-token');
        expect(bundle.meta.url).not.toContain('foreign-private');
      });
      api.afterUpload(({ url }) => {
        calls.push(`after:${url}`);
      });
    }, '/tools/replays');
    const bundle = replay('alias-replay');
    bundle.meta.url = 'https://example.com/?token=private-token&tenant-secret=foreign-private';
    const response = await request(`/tools/replays${path}`, upload({ recording: bundle }));
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({ id: 'alias-replay', url: '/tools/replays/r/alias-replay' });
    expect((await store.load('alias-replay'))?.meta.url).not.toContain('private-token');
    expect((await store.load('alias-replay'))?.meta.url).not.toContain('foreign-private');
    expect(calls).toEqual([
      `alias:service-account:/tools/replays${path}`,
      `global:/tools/replays${path}`,
      'before',
      'after:/tools/replays/r/alias-replay',
    ]);
    const duplicate = await request(path, upload({ recording: bundle }));
    expect(duplicate.status).toBe(409);
    expect(calls.filter((call) => call.startsWith('after:'))).toHaveLength(1);
    const invalid = await request(path, upload({ recording: { invalid: true } }));
    expect(invalid.status).toBe(400);
  });

  it('requires auth and normal CSRF, supports prepare-free aliases, and lets the host confine service identities to the alias', async () => {
    const prepare = vi.fn<PrepareUploadHook>(({ body }) => body);
    const { request, store } = await start((api) => {
      api.uploadEndpoint({ path });
      api.prepareUpload(prepare);
      api.onRequest(({ path: route, identity, response, request: incoming }) => {
        if (identity?.id === 'service-account' && !(route === path && incoming.method === 'POST')) {
          response.writeHead(403);
          response.end('service identity restricted');
          return true;
        }
      });
    });
    expect((await request(path, upload(replay(), { authorization: '' }))).status).toBe(403);
    expect((await request(path, upload(replay(), crossSite))).status).toBe(403);
    expect((await request(path, preflight())).status).toBe(403);
    for (const route of ['/api/replays', '/api/me', '/api/config', '/'])
      expect((await request(route, { headers: { authorization: 'Bearer trusted', accept: 'text/html' } })).status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
    expect((await request(path, upload())).status).toBe(201);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await store.load('test-replay')).toBeDefined();
  });

  it('has no endpoint or CORS permission by default', async () => {
    const { request } = await start(() => {});
    const response = await request(path, upload());
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

const register = (setup: (api: PluginApi) => void) => resolvePlugins([definePlugin({ name: 'host', setup })]);

describe('registration validation', () => {
  it.each([
    { path: '/api/replays/' },
    { path: '/api/*' },
    { path: '/tools/../api/replays' },
    { path: '/api/replays?x=1' },
    { origins: ['*'] },
    { origins: ['null'] },
    { origins: [`${trusted}/`] },
    { origins: ['https://*.example.com'] },
    { origins: ['https://user:pass@app.example.com'] },
    { origins: [] },
    { methods: [] },
    { methods: ['post'] },
    { methods: ['OPTIONS'] },
    { headers: ['*'] },
    { headers: ['bad header'] },
    { credentials: 'yes' },
  ])('rejects unsafe policy %j', async (change) => {
    await expect(register((api) => api.requestPolicy({ ...policy, ...change } as RequestPolicy))).rejects.toMatchObject({
      code: 'invalid-registration',
    });
  });
  it.each(['/api/replays', '/api/suites', '/api/config', '/api/me', '/api/malleable', '/api/replays/import', '/api/a/', '/api/*'])(
    'rejects conflicting or ambiguous alias %s',
    async (path) => {
      await expect(register((api) => api.uploadEndpoint({ path }))).rejects.toMatchObject({ code: 'invalid-registration' });
    },
  );
  it('rejects overlapping policies and aliases in collection and merged registries', async () => {
    await expect(
      register((api) => {
        api.requestPolicy(policy);
        api.requestPolicy({ ...policy, origins: ['https://other.example.com'] });
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      register((api) => {
        api.uploadEndpoint({ path: '/api/foreign' });
        api.uploadEndpoint({ path: '/api/foreign' });
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const a = await register((api) => {
      api.requestPolicy(policy);
      api.uploadEndpoint({ path: '/api/foreign' });
    });
    const b = await resolvePlugins([definePlugin({ name: 'other', setup: (api) => api.requestPolicy(policy) })]);
    expect(() => mergeRegistries(a, b)).toThrow(/overlaps/);
    const c = await resolvePlugins([definePlugin({ name: 'other', setup: (api) => api.uploadEndpoint({ path: '/api/foreign' }) })]);
    expect(() => mergeRegistries(a, c)).toThrow(/registered twice/);
  });
  it('snapshots registrations so later host mutation cannot change a live policy', async () => {
    const origins = [trusted];
    const methods = ['POST'];
    const headers = ['Content-Type'];
    const registry = await register((api) => api.requestPolicy({ ...policy, origins, methods, headers }));
    origins.push('https://other.example.com');
    methods.push('DELETE');
    headers.push('authorization');
    expect(registry.requestPolicies[0]?.value).toEqual(policy);
  });
});
