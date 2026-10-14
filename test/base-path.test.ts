import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { appPath, normalizeBasePath, publicPath, withBase } from '../src/server/base-path.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const INDEX = `<!doctype html><html><head><meta name="app-base" content="" /><meta name="app-name" content="__PRODUCT_NAME__" /><meta name="app-logo" content="__PRODUCT_LOGO__" /><title>__PRODUCT_NAME__</title><link rel="modulepreload" href="./assets/react.js" /><script type="module" src="./assets/main.js"></script></head></html>`;

async function start(basePath: string) {
  const root = await mkdtemp(join(tmpdir(), 'replay-kit-base-'));
  const clientDir = join(root, 'client');
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await writeFile(join(clientDir, 'index.html'), INDEX);
  await writeFile(join(clientDir, 'assets', 'main.js'), 'console.log(1)');
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const handle = createApp({ ...appDefaults(), basePath: normalizeBasePath(basePath), store, clientDir });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

const html = { accept: 'text/html' };

describe('normalizeBasePath', () => {
  it('maps the root and an unset value to the empty prefix', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('  ')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
  });

  it('keeps a path prefix without a trailing slash', () => {
    expect(normalizeBasePath('/replays')).toBe('/replays');
    expect(normalizeBasePath('/replays/')).toBe('/replays');
    expect(normalizeBasePath(' /tools/replays ')).toBe('/tools/replays');
    expect(normalizeBasePath('/a.b/c_d~e-f')).toBe('/a.b/c_d~e-f');
  });

  it('rejects anything that is not an absolute plain path', () => {
    for (const bad of [
      'replays',
      'https://example.com/replays',
      '//evil.example',
      '/a//b',
      '/a/../b',
      '/./a',
      '/a b',
      '/a?x=1',
      '/a#x',
      '/a\\b',
    ])
      expect(() => normalizeBasePath(bad)).toThrow(/BASE_PATH/);
  });
});

describe('appPath and publicPath', () => {
  it('maps a request path onto the canonical routes, prefixed or already stripped', () => {
    expect(appPath('/replays/api/replays', '/replays')).toBe('/api/replays');
    expect(appPath('/api/replays', '/replays')).toBe('/api/replays');
    expect(appPath('/replays', '/replays')).toBe('/');
    expect(appPath('/replays/', '/replays')).toBe('/');
    // A sibling path that merely starts with the same letters is not under the prefix.
    expect(appPath('/replays-old/r/a', '/replays')).toBe('/replays-old/r/a');
    expect(appPath('/r/a', '')).toBe('/r/a');
    expect(appPath('/', '')).toBe('/');
  });

  it('builds public paths for the links the server writes', () => {
    expect(publicPath('/r/abc', '')).toBe('/r/abc');
    expect(publicPath('/r/abc', '/replays')).toBe('/replays/r/abc');
    expect(publicPath('/', '/replays')).toBe('/replays/');
    expect(publicPath('', '')).toBe('/');
  });
});

describe('withBase', () => {
  it('declares the base and makes the asset URLs absolute', () => {
    expect(withBase(INDEX, '')).toContain('<meta name="app-base" content="/" />');
    expect(withBase(INDEX, '')).toContain('src="/assets/main.js"');
    const prefixed = withBase(INDEX, '/replays');
    expect(prefixed).toContain('<meta name="app-base" content="/replays" />');
    expect(prefixed).toContain('src="/replays/assets/main.js"');
    expect(prefixed).toContain('href="/replays/assets/react.js"');
  });

  it('leaves the placeholders alone without branding', () => {
    expect(withBase(INDEX, '')).toContain('__PRODUCT_NAME__');
  });
});

describe('served at the root', () => {
  it('serves the app, its API and the assets at the root of the domain', async () => {
    const origin = await start('/');
    const page = await fetch(`${origin}/r/test-replay`, { headers: html });
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('<meta name="app-base" content="/" />');
    expect(body).toContain('src="/assets/main.js"');
    expect((await fetch(`${origin}/assets/main.js`)).status).toBe(200);
    expect(await (await fetch(`${origin}/api/replays`)).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'test-replay' })]),
    );
    expect((await fetch(`${origin}/api/replays/test-replay`)).status).toBe(200);
    for (const path of ['/', '/healthz']) expect(await (await fetch(`${origin}${path}`)).text()).toBe('ok');
    const index = await fetch(`${origin}/`, { headers: html });
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<title>Replay Kit</title>');
  });

  it('writes upload receipts without a prefix', async () => {
    const origin = await start('');
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay('on-root')),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'on-root', url: '/r/on-root' });
  });
});

describe('served under /replays', () => {
  it('serves prefixed requests: pages, API, assets, health', async () => {
    const origin = await start('/replays');
    for (const path of ['/replays', '/replays/', '/replays/r/test-replay', '/replays/s/review-1/r/test-replay']) {
      const page = await fetch(`${origin}${path}`, { headers: html });
      expect([path, page.status]).toEqual([path, 200]);
      const body = await page.text();
      expect(body).toContain('<meta name="app-base" content="/replays" />');
      expect(body).toContain('src="/replays/assets/main.js"');
    }
    expect((await fetch(`${origin}/replays/assets/main.js`)).status).toBe(200);
    expect(await (await fetch(`${origin}/replays/api/replays`)).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'test-replay' })]),
    );
    expect((await fetch(`${origin}/replays/api/replays/test-replay`)).status).toBe(200);
    expect(await (await fetch(`${origin}/replays/healthz`)).text()).toBe('ok');
    expect(await (await fetch(`${origin}/replays`)).text()).toBe('ok');
  });

  it('also serves requests whose prefix a reverse proxy already stripped', async () => {
    const origin = await start('/replays');
    const page = await fetch(`${origin}/r/test-replay`, { headers: html });
    expect(page.status).toBe(200);
    // The page still declares the public base, so the client builds prefixed URLs.
    expect(await page.text()).toContain('<meta name="app-base" content="/replays" />');
    expect((await fetch(`${origin}/assets/main.js`)).status).toBe(200);
    expect((await fetch(`${origin}/api/replays/test-replay`)).status).toBe(200);
    expect(await (await fetch(`${origin}/healthz`)).text()).toBe('ok');
  });

  it('writes upload receipts with the prefix, whichever shape the request had', async () => {
    const origin = await start('/replays');
    const post = (path: string, id: string) =>
      fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(replay(id)) });
    const prefixed = await post('/replays/api/replays', 'prefixed');
    expect(await prefixed.json()).toEqual({ id: 'prefixed', url: '/replays/r/prefixed' });
    const stripped = await post('/api/replays', 'stripped');
    expect(await stripped.json()).toEqual({ id: 'stripped', url: '/replays/r/stripped' });
  });

  it('keeps unknown API paths as JSON 404s under the prefix', async () => {
    const origin = await start('/replays');
    const response = await fetch(`${origin}/replays/api/nope`, { headers: html });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
  });
});
