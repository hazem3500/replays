import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import { createApp } from '../src/server/app.ts';
import { noneAuth } from '../src/server/auth/index.ts';
import type { AuthAdapter } from '../src/server/auth/index.ts';
import { validateBranding } from '../src/server/branding.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { SourceProviders } from '../src/shared/source-providers.ts';
import { replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** An auth adapter that never recognises anyone: every request is refused. */
const refusing: AuthAdapter = { name: 'refusing', authenticate: () => undefined };

async function start(auth: AuthAdapter = noneAuth({}), basePath = '') {
  const root = await mkdtemp(join(tmpdir(), 'replays-upload-'));
  const dataDir = join(root, 'data');
  const store = new ReplayStore(dataDir, join(root, 'sample'));
  const handle = createApp({
    auth,
    store,
    clientDir: join(root, 'client'),
    branding: validateBranding(undefined),
    sources: new SourceProviders(),
    basePath,
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, store, dataDir, api: `${origin}${basePath}/api/replays` };
}

const snapshot = (value = 'hunter2') => ({
  type: 0,
  id: 1,
  childNodes: [{ type: 2, id: 2, tagName: 'input', attributes: { type: 'password', value }, childNodes: [] }],
});

const rrweb = () => [
  { type: 4, data: { href: 'https://app.example.com/login?api_token=leaked&next=%2F', width: 390, height: 844 }, timestamp: 1000 },
  { type: 2, data: { node: snapshot() }, timestamp: 1001 },
  { type: 3, data: { source: 5, id: 2, text: 'typed-secret' }, timestamp: 2500 },
];

function post(url: string, body: string | Buffer, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });
}

describe('POST /api/replays/import', () => {
  it('imports plain rrweb events through the shared importer and stores them', async () => {
    const { api } = await start();
    const response = await post(`${api}/import?title=${encodeURIComponent('Login bug')}`, JSON.stringify(rrweb()));
    expect(response.status).toBe(201);
    const receipt = (await response.json()) as { id: string; url: string };
    expect(receipt.id).toMatch(/^app-example-com-1970-01-01-000001-[a-f0-9]{6}$/);
    expect(receipt.url).toBe(`/r/${receipt.id}`);
    const stored = (await (await fetch(`${api}/${receipt.id}`)).json()) as ReplayBundle;
    expect(stored.meta).toMatchObject({ title: 'Login bug', source: 'human', duration: 1500, viewport: { width: 390, height: 844 } });
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain('leaked');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('typed-secret');
  });

  it('accepts an { events } object, explicit id and url, and a default title', async () => {
    const { api } = await start();
    const events = rrweb().filter((event) => event.type !== 4);
    const response = await post(
      `${api}/import?id=my-upload&url=${encodeURIComponent('https://example.com/start')}`,
      JSON.stringify({ events }),
    );
    expect(response.status).toBe(201);
    const stored = (await (await fetch(`${api}/my-upload`)).json()) as ReplayBundle;
    expect(stored.meta).toMatchObject({ id: 'my-upload', title: 'Imported recording', url: 'https://example.com/start' });
    const again = await post(`${api}/import?id=my-upload&url=https://example.com/`, JSON.stringify({ events }));
    expect(again.status).toBe(409);
  });

  it('stores repeated ?tag= parameters as meta.tags, filters the list by them and rejects bad tags', async () => {
    const { api } = await start();
    const response = await post(`${api}/import?id=smoke-run&tag=smoke&tag=checkout`, JSON.stringify(rrweb()));
    expect(response.status).toBe(201);
    expect((await post(`${api}/import?id=plain-run`, JSON.stringify(rrweb()))).status).toBe(201);
    const stored = (await (await fetch(`${api}/smoke-run`)).json()) as ReplayBundle;
    expect(stored.meta.tags).toEqual(['smoke', 'checkout']);
    const listed = (await (await fetch(`${api}?tag=checkout`)).json()) as Array<{ id: string; tags?: string[] }>;
    expect(listed.map((summary) => [summary.id, summary.tags])).toEqual([['smoke-run', ['smoke', 'checkout']]]);
    const rejected = await post(`${api}/import?id=nope&tag=Not%20A%20Tag`, JSON.stringify(rrweb()));
    expect(rejected.status).toBe(400);
    expect((await fetch(`${api}/nope`)).status).toBe(404);
  });

  it('gives each upload of the same recording its own id', async () => {
    const { api } = await start();
    const ids = new Set<string>();
    for (let index = 0; index < 4; index++) {
      const response = await post(`${api}/import`, JSON.stringify(rrweb()));
      expect(response.status).toBe(201);
      ids.add(((await response.json()) as { id: string }).id);
    }
    expect(ids.size).toBe(4);
  });

  it('redacts URLs in the title query parameter like every other stored string', async () => {
    const { api } = await start();
    const title = 'Broke on https://app.example.com/?api_token=title-leak';
    const response = await post(`${api}/import?title=${encodeURIComponent(title)}`, JSON.stringify(rrweb()));
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const stored = (await (await fetch(`${api}/${id}`)).json()) as ReplayBundle;
    expect(stored.meta.title).toContain('https://app.example.com/');
    expect(JSON.stringify(stored)).not.toContain('title-leak');
  });

  it('accepts a gzip-encoded body', async () => {
    const { api } = await start();
    const response = await post(`${api}/import?title=Zipped`, gzipSync(JSON.stringify(rrweb())), { 'content-encoding': 'gzip' });
    expect(response.status).toBe(201);
  });

  it.each([
    ['not JSON', '{"events": [', 400, /not valid JSON/],
    ['empty', '', 400, /empty/],
    ['no events', JSON.stringify({ data: [] }), 400, /array of rrweb events/],
    ['one event', JSON.stringify([rrweb()[0]]), 400, /at least two events/],
    ['no full snapshot', JSON.stringify([rrweb()[0], rrweb()[2]]), 400, /no full snapshot/],
  ])('rejects %s with a clear 400', async (_name, body, status, message) => {
    const { api } = await start();
    const response = await post(`${api}/import`, body);
    expect(response.status).toBe(status);
    expect(await response.text()).toMatch(message);
  });

  it('rejects a bad id, bad gzip, unknown encodings and oversized bodies', async () => {
    const { api } = await start();
    expect((await post(`${api}/import?id=Bad%20Id`, JSON.stringify(rrweb()))).status).toBe(400);
    const badGzip = await post(`${api}/import`, 'not gzip', { 'content-encoding': 'gzip' });
    expect(badGzip.status).toBe(400);
    expect(await badGzip.text()).toMatch(/not valid gzip/);
    expect((await post(`${api}/import`, JSON.stringify(rrweb()), { 'content-encoding': 'br' })).status).toBe(415);
    const huge = await post(`${api}/import`, `[${' '.repeat(25 * 1024 * 1024)}]`);
    expect(huge.status).toBe(413);
    expect(await huge.text()).toMatch(/larger than 25 MB/);
    const bomb = await post(`${api}/import`, gzipSync(Buffer.alloc(26 * 1024 * 1024, 32)), { 'content-encoding': 'gzip' });
    expect(bomb.status).toBe(413);
    expect(await bomb.text()).toMatch(/once decompressed/);
  });

  it('sits behind the auth adapter and the same-origin check like every other route', async () => {
    const { api } = await start(refusing);
    expect((await post(`${api}/import`, JSON.stringify(rrweb()))).status).toBe(403);
    const open = await start();
    expect(
      (await post(`${open.api}/import`, JSON.stringify(rrweb()), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))
        .status,
    ).toBe(403);
  });
});

const leaky = () => {
  const bundle = replay('leaky-bundle');
  bundle.meta.url = 'https://app.example.com/timer?api_token=x';
  bundle.events = [
    { type: 4, data: { href: 'https://app.example.com/timer?api_token=x', width: 1280, height: 720 }, timestamp: 1000 },
    { type: 2, data: { node: snapshot('unmasked-value') }, timestamp: 2000 },
    { type: 3, data: { source: 5, id: 2, text: 'unmasked-value' }, timestamp: 2100 },
  ];
  bundle.steps = [{ at: 0, kind: 'open', label: 'Open', url: 'https://app.example.com/?client_secret=x' }];
  bundle.console = [{ at: 0, level: 'error', message: 'GET https://api.app.example.com/me?api_token=console-secret 401' }];
  bundle.network = [
    {
      id: 'request-1',
      at: 0,
      duration: 1,
      method: 'GET',
      url: 'https://api.app.example.com/me?api_token=x',
      status: 200,
      statusText: 'OK',
      requestHeaders: [
        { name: 'Authorization', value: 'Basic secret-auth' },
        { name: 'Referer', value: 'https://app.example.com/?session=x' },
      ],
      responseHeaders: [{ name: 'Set-Cookie', value: 'sid=secret-cookie' }],
    },
  ];
  return bundle;
};

describe('POST /api/replays sanitizes client bundles', () => {
  it('stores a bundle with neither unmasked inputs nor sensitive query values', async () => {
    const { api, dataDir } = await start();
    const response = await post(api, JSON.stringify(leaky()));
    expect(response.status).toBe(201);
    const onDisk = await readFile(join(dataDir, 'leaky-bundle', 'replay.json'), 'utf8');
    for (const secret of [
      'api_token=x',
      'unmasked-value',
      'client_secret=x',
      'session=x',
      'secret-auth',
      'secret-cookie',
      'console-secret',
    ]) {
      expect(onDisk).not.toContain(secret);
    }
    expect(onDisk).toContain('api_token=%5Bredacted%5D');
    expect(onDisk).toContain('*'.repeat('unmasked-value'.length));
  });

  it('rejects a gzipped bundle that is over the cap once decompressed', async () => {
    const { api } = await start();
    const bomb = await post(api, gzipSync(Buffer.alloc(26 * 1024 * 1024, 32)), { 'content-encoding': 'gzip' });
    expect(bomb.status).toBe(413);
    expect(await bomb.text()).toMatch(/once decompressed/);
  });

  it('accepts gzip and is idempotent for already-sanitized bundles', async () => {
    const { api } = await start();
    const clean = sanitizeReplayBundle(leaky());
    expect(sanitizeReplayBundle(structuredClone(clean))).toEqual(clean);
    const response = await post(api, gzipSync(JSON.stringify(leaky())), { 'content-encoding': 'gzip' });
    expect(response.status).toBe(201);
    expect(await (await fetch(`${api}/leaky-bundle`)).json()).toEqual(clean);
  });
});

describe('errors without an explicit status', () => {
  it('answer a generic 500 instead of leaking the raw message', async () => {
    const { api, store } = await start();
    store.save = async () => {
      throw Object.assign(new Error("EACCES: permission denied, open '/data/secret-path/replay.json'"), {
        code: 'EACCES',
        syscall: 'open',
      });
    };
    const response = await post(`${api}/import`, JSON.stringify(rrweb()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal error' });

    store.list = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'secret')");
    };
    const list = await fetch(api);
    expect(list.status).toBe(500);
    expect(await list.text()).not.toContain('secret');
  });

  it('keep 4xx messages for invalid input', async () => {
    const { origin } = await start();
    const suite = await fetch(`${origin}/api/suites/some-suite`, { method: 'PUT', body: '{not json' });
    expect(suite.status).toBe(400);
    const bundle = await post(`${origin}/api/replays`, JSON.stringify({ meta: { id: 'Bad Id' } }));
    expect(bundle.status).toBe(400);
    expect(await bundle.text()).toMatch(/replay id must contain/);
    const url = await post(`${origin}/api/replays/import?url=https://`, JSON.stringify(rrweb()));
    expect(url.status).toBe(400);
  });
});
