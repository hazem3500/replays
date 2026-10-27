import { createServer, request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, onTestFinished } from 'vitest';

import { definePlugin, HttpError, PluginError, resolvePlugins, tooManyRequests, type PluginApi } from '../src/plugin/index.ts';
import { createApp, type AppOptions } from '../src/server/app.ts';
import type { AuthAdapter, Identity } from '../src/server/auth/types.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const ENDPOINT = '/api/ingest/v1/recordings';
const KEY = 'app-key-1';

const staffOnly: AuthAdapter = { name: 'staff', authenticate: (request) => (request.headers['x-staff'] ? { id: 'staff' } : undefined) };

function appKey(request: { headers: Record<string, string | string[] | undefined> }): Identity | undefined {
  if (request.headers['x-app-key'] === 'disabled') throw new HttpError(403, 'app is disabled');
  return request.headers['x-app-key'] === KEY ? { id: 'app:focus', name: 'Focus' } : undefined;
}

async function start(setup: (api: PluginApi) => void, options: Partial<AppOptions> = {}) {
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples');
  const plugins = await resolvePlugins([definePlugin({ name: 'host', setup })]);
  const app = createApp({ ...appDefaults(), store, plugins, clientDir: '/nonexistent-client', ...options });
  const server = createServer((req, res) => void app(req, res));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`${origin}${path}`, init);
  const post = (body: unknown, headers: Record<string, string> = {}, path = ENDPOINT) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { store, call, post, port: address.port };
}

/** `<status> <body>` for a POST written chunk by chunk; `end: false` leaves the body unfinished, as a slow client would. */
function rawPost(
  port: number,
  path: string,
  { headers, chunks, end = true }: { headers: Record<string, string>; chunks: readonly string[]; end?: boolean },
) {
  return new Promise<string>((resolve, reject) => {
    const request = httpRequest({ port, path, method: 'POST', headers });
    request.on('response', (response) => {
      let data = '';
      response.on('data', (part: Buffer) => (data += part.toString()));
      response.on('end', () => resolve(`${response.statusCode} ${data}`));
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    if (end) request.end();
  });
}

const ingest =
  (extra: Partial<Parameters<PluginApi['uploadEndpoint']>[0]> = {}) =>
  (api: PluginApi) =>
    api.uploadEndpoint({ path: ENDPOINT, authenticate: appKey, ...extra });

describe('upload endpoint credentials', () => {
  it('answers 401 without the endpoint credential and never consults the deployment adapter', async () => {
    const { post, store } = await start(ingest(), { auth: staffOnly });
    const response = await post(replay(), { 'x-staff': '1' });
    expect(response.status).toBe(401);
    expect(await store.list()).toEqual([]);
  });

  it('answers the status a resolver throws, such as 403 for a disabled app', async () => {
    const { post } = await start(ingest(), { auth: staffOnly });
    const response = await post(replay(), { 'x-app-key': 'disabled' });
    expect([response.status, await response.text()]).toEqual([403, 'app is disabled']);
  });

  it('stores an upload made with the endpoint credential', async () => {
    const { post, store } = await start(ingest(), { auth: staffOnly });
    const response = await post(replay('from-app'), { 'x-app-key': KEY });
    expect(response.status).toBe(201);
    expect((await store.load('from-app'))?.meta.title).toBe('Test replay');
  });

  it('does not let an endpoint credential authenticate any other route', async () => {
    const { call } = await start(ingest(), { auth: staffOnly });
    const response = await call('/api/replays', { headers: { 'x-app-key': KEY } });
    expect(response.status).toBe(403);
  });

  it('refuses every method but POST on the endpoint path itself', async () => {
    const { call } = await start(ingest(), { auth: staffOnly });
    const response = await call(ENDPOINT, { headers: { 'x-app-key': KEY } });
    expect([response.status, await response.text()]).toEqual([403, 'identity cannot access this route']);
  });
});

describe('identity capabilities', () => {
  const forwarder: AuthAdapter = {
    name: 'forwarder',
    authenticate: () => ({ id: 'svc', capabilities: { routes: [{ method: 'POST', path: '/api/forwarded' }] } }),
  };
  const routes: Array<[string, string]> = [
    ['GET', '/api/replays'],
    ['GET', '/api/replays/test-replay'],
    ['PUT', '/api/replays/test-replay/edits'],
    ['PUT', '/api/replays/test-replay/keep'],
    ['DELETE', '/api/replays/test-replay/keep'],
    ['GET', '/api/replays/test-replay/video'],
    ['GET', '/api/replays/test-replay/poster'],
    ['GET', '/api/replays/test-replay/comments'],
    ['POST', '/api/malleable/bridge/pair'],
    ['GET', '/api/me'],
    ['POST', '/api/replays'],
  ];

  it.each(routes)('refuses a write-only identity on %s %s before any route answers', async (method, path) => {
    const { call, store } = await start((api) => api.uploadEndpoint({ path: '/api/forwarded' }), {
      auth: forwarder,
      comments: { enabled: true },
      beta: { editor: true, malleable: true },
    });
    await store.save(replay());
    const response = await call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    expect([response.status, await response.text()]).toEqual([403, 'identity cannot access this route']);
  });

  it('lets a write-only identity post to its granted endpoint', async () => {
    const { post } = await start((api) => api.uploadEndpoint({ path: '/api/forwarded' }), { auth: forwarder });
    expect((await post(replay(), {}, '/api/forwarded')).status).toBe(201);
  });

  it('lets an upload-scoped token reach registered upload endpoints', async () => {
    const scoped: AuthAdapter = { name: 'scoped', authenticate: () => ({ id: 'cli', authScopes: ['replays:upload'] }) };
    const { post, call } = await start((api) => api.uploadEndpoint({ path: '/api/forwarded' }), { auth: scoped });
    expect((await post(replay(), {}, '/api/forwarded')).status).toBe(201);
    expect((await call('/api/replays')).status).toBe(403);
  });
});

describe('upload endpoint body limits', () => {
  it('refuses a declared Content-Length over the endpoint limit before the body arrives', async () => {
    const { port } = await start(ingest({ maxBytes: 1024 }));
    const answer = await rawPost(port, ENDPOINT, { headers: { 'x-app-key': KEY, 'content-length': '50000' }, chunks: ['{'], end: false });
    expect(answer).toBe('413 upload is larger than 1024 bytes');
  });

  it('refuses a streamed body that passes the limit without a declared length', async () => {
    const { port } = await start(ingest({ maxBytes: 1024 }));
    const answer = await rawPost(port, ENDPOINT, { headers: { 'x-app-key': KEY }, chunks: [' '.repeat(800), ' '.repeat(800)] });
    expect(answer).toBe('413 upload is larger than 1024 bytes');
  });

  it('refuses a small gzip body that decompresses past the limit', async () => {
    const { call } = await start(ingest({ maxBytes: 64 * 1024 }));
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x20));
    const response = await call(ENDPOINT, {
      method: 'POST',
      headers: { 'x-app-key': KEY, 'content-encoding': 'gzip', 'content-type': 'application/json' },
      body: new Uint8Array(bomb),
    });
    expect([response.status, await response.text()]).toEqual([413, 'upload is larger than 65536 bytes once decompressed']);
  });

  it('takes the limit per identity from a function', async () => {
    const { post } = await start(ingest({ maxBytes: ({ identity }) => (identity.id === 'app:focus' ? 100 : 1e6) }));
    expect((await post(replay(), { 'x-app-key': KEY })).status).toBe(413);
  });

  it('keeps the 25 MB core limit message on /api/replays', async () => {
    const { port } = await start(() => {});
    const answer = await rawPost(port, '/api/replays', {
      headers: { 'content-length': String(26 * 1024 * 1024) },
      chunks: ['{'],
      end: false,
    });
    expect(answer).toBe('413 upload is larger than 25 MB');
  });
});

describe('upload endpoint errors', () => {
  it('answers an invalid envelope with the same 400 text as /api/replays', async () => {
    const { post } = await start(ingest());
    const invalid = { ...replay(), meta: { ...replay().meta, url: 3 } };
    const custom = await post(invalid, { 'x-app-key': KEY });
    const core = await post(invalid, {}, '/api/replays');
    expect([custom.status, custom.headers.get('content-type'), await custom.text()]).toEqual([
      400,
      'text/plain; charset=utf-8',
      await core.text(),
    ]);
  });

  it('accepts a JSON body whatever its Content-Type says', async () => {
    const { call } = await start(ingest());
    const body = new Uint8Array(gzipSync(JSON.stringify(replay())));
    const response = await call(ENDPOINT, {
      method: 'POST',
      headers: { 'x-app-key': KEY, 'content-type': 'text/plain', 'content-encoding': 'gzip' },
      body,
    });
    expect(response.status).toBe(201);
  });

  it.each([
    {
      name: 'an unsupported Content-Encoding',
      headers: { 'content-encoding': 'br' },
      body: '{}',
      answer: [415, 'unsupported content-encoding: br'],
    },
    { name: 'a corrupt gzip stream', headers: { 'content-encoding': 'gzip' }, body: 'not gzip', answer: [400, 'body is not valid gzip'] },
    { name: 'a body that is not JSON', headers: {}, body: 'not json', answer: [400, 'body is not valid JSON'] },
  ])('answers $name like /api/replays', async ({ headers, body, answer }) => {
    const { call } = await start(ingest());
    const response = await call(ENDPOINT, { method: 'POST', headers: { 'x-app-key': KEY, ...headers }, body });
    expect([response.status, await response.text()]).toEqual(answer);
  });
});

describe('upload endpoint rate limits', () => {
  it('answers 429 with Retry-After before reading the body', async () => {
    const prepared: unknown[] = [];
    const { post } = await start(ingest({ rateLimit: () => ({ retryAfter: 12.2 }), prepare: ({ body }) => (prepared.push(body), body) }));
    const response = await post(replay(), { 'x-app-key': KEY });
    expect([response.status, response.headers.get('retry-after'), prepared]).toEqual([429, '13', []]);
  });

  it('passes Retry-After through when a resolver throws tooManyRequests', async () => {
    const { post } = await start((api) =>
      api.uploadEndpoint({
        path: ENDPOINT,
        authenticate: () => {
          throw tooManyRequests(30, 'slow down');
        },
      }),
    );
    const response = await post(replay());
    expect([response.status, response.headers.get('retry-after'), await response.text()]).toEqual([429, '30', 'slow down']);
  });
});

const browser = (api: PluginApi) => {
  ingest()(api);
  api.requestPolicy({ path: ENDPOINT, methods: ['POST'], origins: ['https://app.example.com'], headers: ['content-type', 'x-app-key'] });
};

describe('upload endpoint browser policy', () => {
  it('answers an allowed preflight without asking for the credential', async () => {
    const { call } = await start(browser);
    const response = await call(ENDPOINT, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-app-key',
      },
    });
    expect([
      response.status,
      response.headers.get('access-control-allow-origin'),
      response.headers.get('access-control-allow-credentials'),
    ]).toEqual([204, 'https://app.example.com', null]);
  });

  it('refuses a preflight from an unlisted origin', async () => {
    const { call } = await start(browser);
    const response = await call(ENDPOINT, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses an actual cross-site upload from an unlisted origin', async () => {
    const { post, store } = await start(browser);
    const response = await post(replay(), { 'x-app-key': KEY, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
    expect(await store.list()).toEqual([]);
  });

  it('allows an upload from a listed origin with its CORS header', async () => {
    const { post } = await start(browser);
    const response = await post(replay(), { 'x-app-key': KEY, origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' });
    expect([response.status, response.headers.get('access-control-allow-origin')]).toEqual([201, 'https://app.example.com']);
  });
});

const forced = (api: PluginApi) =>
  ingest({
    normalize: ({ bundle, identity }) => {
      const { people: _people, ...meta } = bundle.meta;
      return {
        ...bundle,
        meta: { ...meta, id: 'server-chosen', title: `${identity.name}: ${meta.title}`, url: 'https://app.example.com/?token=secret' },
      };
    },
  })(api);

const retitle = (api: PluginApi) =>
  api.normalizeUpload(({ bundle, path }) => ({ ...bundle, meta: { ...bundle.meta, title: `${path} upload` } }));

describe('upload normalization', () => {
  it('stores what the endpoint normalization returns', async () => {
    const { post, store } = await start(forced);
    const client = { ...replay(), meta: { ...replay().meta, people: [{ role: 'reporter', email: 'someone@example.com' }] } };
    expect((await post(client, { 'x-app-key': KEY })).status).toBe(201);
    const stored = await store.load('server-chosen');
    expect([stored?.meta.title, stored?.meta.people, await store.load('test-replay')]).toEqual([
      'Focus: Test replay',
      undefined,
      undefined,
    ]);
  });

  it('runs the privacy pass on the normalized bundle', async () => {
    const { post, store } = await start(forced);
    await post(replay(), { 'x-app-key': KEY });
    expect((await store.load('server-chosen'))?.meta.url).toContain('token=%5Bredacted%5D');
  });

  it('validates the normalized bundle again', async () => {
    const { post, store } = await start(ingest({ normalize: ({ bundle }) => void Object.assign(bundle.meta.viewport, { width: 'wide' }) }));
    expect((await post(replay(), { 'x-app-key': KEY })).status).toBe(400);
    expect(await store.list()).toEqual([]);
  });

  it('applies normalizeUpload hooks to core uploads too', async () => {
    const { post, store } = await start(retitle);
    await post(replay(), {}, '/api/replays');
    expect((await store.load('test-replay'))?.meta.title).toBe('/api/replays upload');
  });
});

describe('upload receipts', () => {
  it('answers with the endpoint receipt and an absolute replayUrl', async () => {
    const { post } = await start(ingest({ receipt: ({ bundle, replayUrl }) => ({ id: bundle.meta.id, reference: 'REF-1', replayUrl }) }), {
      publicOrigin: 'https://replays.example.com',
      basePath: '/replays',
    });
    const response = await post(replay(), { 'x-app-key': KEY }, `/replays${ENDPOINT}`);
    expect(await response.json()).toEqual({
      id: 'test-replay',
      reference: 'REF-1',
      replayUrl: 'https://replays.example.com/replays/r/test-replay',
    });
  });

  it('keeps the core { id, url } receipt on /api/replays', async () => {
    const { post } = await start(ingest({ receipt: () => ({ other: true }) }));
    expect(await (await post(replay(), {}, '/api/replays')).json()).toEqual({ id: 'test-replay', url: '/r/test-replay' });
  });

  it('serves an endpoint at a prefixed path under a host base path', async () => {
    const { post } = await start((api) => api.uploadEndpoint({ path: '/backoffice/api/customer-recordings' }), {
      basePath: '/toggl-replays',
    });
    expect((await post(replay(), {}, '/toggl-replays/backoffice/api/customer-recordings')).status).toBe(201);
  });
});

describe('upload endpoint registration', () => {
  it.each(['/api/replays/extra', '/api/cli/upload', '/internal/render/x', '/api/agent-tools', '/single', '/API/Upper'])(
    'refuses the path %s',
    async (path) => {
      await expect(resolvePlugins([definePlugin({ name: 'host', setup: (api) => api.uploadEndpoint({ path }) })])).rejects.toBeInstanceOf(
        PluginError,
      );
    },
  );

  it('refuses a maxBytes that is not a positive whole number', async () => {
    await expect(
      resolvePlugins([definePlugin({ name: 'host', setup: (api) => api.uploadEndpoint({ path: ENDPOINT, maxBytes: 0 }) })]),
    ).rejects.toThrow(/maxBytes/);
  });
});
