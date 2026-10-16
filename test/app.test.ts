import { createServer, get } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** An adapter that never recognises anyone, with no way to sign in. */
const closedAuth: AuthAdapter = { name: 'closed', authenticate: () => undefined };

async function start(auth: AuthAdapter = appDefaults().auth) {
  const root = await mkdtemp(join(tmpdir(), 'replays-app-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const handle = createApp({ ...appDefaults(), auth, store, clientDir: join(root, 'client') });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  return { origin: `http://127.0.0.1:${address.port}`, store, root };
}

describe('replay server', () => {
  it('answers the health check without an identity, for anything that is not a browser page load', async () => {
    const { origin } = await start(closedAuth);
    for (const headers of [{}, { accept: '*/*' }, { 'user-agent': 'curl/8.0' }]) {
      const response = await fetch(origin, { headers });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    }
    expect(await (await fetch(`${origin}/healthz`)).text()).toBe('ok');
  });

  it('sends a browser without an identity to the sign-in page when the adapter has one, else refuses', async () => {
    const withLogin: AuthAdapter = { ...closedAuth, loginUrl: () => '/auth/login' };
    const { origin } = await start(withLogin);
    // fetch() rewrites Sec-Fetch-Mode itself, so the navigation header goes over plain http.
    const navigation = await new Promise<{ status: number | undefined; location: string | undefined }>((resolve, reject) => {
      get(`${origin}/`, { headers: { 'sec-fetch-mode': 'navigate' } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      }).on('error', reject);
    });
    expect(navigation).toEqual({ status: 302, location: '/auth/login' });
    expect((await fetch(`${origin}/api/replays`)).status).toBe(401);

    const closed = await start(closedAuth);
    expect((await fetch(`${closed.origin}/api/replays`)).status).toBe(403);
    expect((await fetch(`${closed.origin}/r/anything`, { headers: { accept: 'text/html' } })).status).toBe(403);
  });

  it('requires an identity for every API route', async () => {
    const { origin } = await start(closedAuth);
    for (const path of ['api/replays', 'api/replays/test-replay', 'api/suites', 'api/me', 'api/config']) {
      expect((await fetch(`${origin}/${path}`)).status).toBe(403);
    }
  });

  it('serves the index page with the product name filled in', async () => {
    const { origin, root } = await start();
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(
      join(root, 'client', 'index.html'),
      '<!doctype html><html><head><meta name="app-base" content="" /><title>__PRODUCT_NAME__</title></head><body></body></html>',
    );
    const page = await fetch(`${origin}/r/test-replay`, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<title>replays</title>');
    expect(html).not.toContain('__PRODUCT_NAME__');
  });

  it('uploads and reads a replay under the API', async () => {
    const { origin } = await start();
    const upload = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay()),
    });
    expect(upload.status).toBe(201);
    await expect(upload.json()).resolves.toEqual({ id: 'test-replay', url: '/r/test-replay' });
    const response = await fetch(`${origin}/api/replays/test-replay`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ meta: { id: 'test-replay' } });
  });

  it('answers /api/me with the identity and /api/config with the public settings', async () => {
    const { origin } = await start();
    const me = await fetch(`${origin}/api/me`, { headers: { 'x-dev-user': 'ada@example.com' } });
    await expect(me.json()).resolves.toEqual({ id: 'ada@example.com', email: 'ada@example.com' });
    const config = await (await fetch(`${origin}/api/config`)).json();
    expect(config).toEqual({
      name: 'replays',
      sourceProviders: ['github', 'gitlab', 'url'],
      auth: 'none',
      beta: { editor: false },
      comments: false,
    });
  });

  it('answers unknown and malformed API paths with a JSON 404, not the SPA page', async () => {
    let middlewareCalls = 0;
    const root = await mkdtemp(join(tmpdir(), 'replays-app-'));
    const handle = createApp({
      ...appDefaults(),
      store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
      clientDir: join(root, 'client'),
      // Stands in for Vite's SPA fallback in `pnpm dev`.
      devMiddleware: (_request, response) => {
        middlewareCalls += 1;
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html>');
      },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    for (const path of ['api/replays/..%2F..%2Fetc', 'api/replays/Bad%20Id', 'api/nope']) {
      const response = await fetch(`http://127.0.0.1:${port}/${path}`, { headers: { accept: 'text/html' } });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    }
    expect(middlewareCalls).toBe(0);
  });

  it('accepts bounded performance entries and rejects unbounded uploads', async () => {
    const { origin } = await start();
    const endpoint = `${origin}/api/replays`;
    const bundle = replay();
    bundle.performance = {
      supported: ['paint', 'longtask', 'event'],
      entries: [
        { at: 12, kind: 'long-task', value: 74 },
        { at: 35, kind: 'slow-interaction', value: 86, eventType: 'click' },
      ],
    };
    const uploaded = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(uploaded.status).toBe(201);
    await expect((await fetch(`${endpoint}/test-replay`)).json()).resolves.toMatchObject({
      performance: { entries: [{ kind: 'long-task' }, { kind: 'slow-interaction', eventType: 'click' }] },
    });

    const tooLarge = replay('too-large-performance');
    tooLarge.performance = { supported: ['event'], entries: Array.from({ length: 501 }, () => ({ at: 1, kind: 'long-task', value: 60 })) };
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(tooLarge),
        })
      ).status,
    ).toBe(400);
  });

  it('round-trips optional test context, keeps source links and rejects invalid context before storage', async () => {
    const { origin } = await start();
    const endpoint = `${origin}/api/replays`;
    const bundle = replay('context-replay');
    bundle.context = {
      version: 1,
      capturedAt: '2026-10-10T12:00:00.000Z',
      app: { name: 'Shop Demo', environment: 'staging', version: '2026.10.10.1234', commit: 'a1b2c3d' },
      test: { suite: 'checkout', case: 'applies a coupon', runId: 'run-1' },
      sources: [
        {
          provider: 'github',
          ref: 'example-org/shop-demo#42',
          url: 'https://github.com/example-org/shop-demo/issues/42',
          label: 'example-org/shop-demo#42',
        },
        { provider: 'url', url: 'https://tickets.example.com/browse/SHOP-7', label: 'Ticket SHOP-7' },
      ],
      fields: { feature: 'coupons', retries: 2 },
    };
    const uploaded = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(uploaded.status).toBe(201);
    await expect((await fetch(`${endpoint}/context-replay`)).json()).resolves.toMatchObject({
      context: {
        app: { name: 'Shop Demo', commit: 'a1b2c3d' },
        test: { case: 'applies a coupon' },
        sources: [
          {
            provider: 'github',
            ref: 'example-org/shop-demo#42',
            url: 'https://github.com/example-org/shop-demo/issues/42',
            label: 'example-org/shop-demo#42',
          },
          { provider: 'url', url: 'https://tickets.example.com/browse/SHOP-7', label: 'Ticket SHOP-7' },
        ],
        fields: { feature: 'coupons', retries: 2 },
      },
    });

    for (const [id, context] of [
      ['unknown-key', { ...bundle.context, account: { id: 1 } }],
      ['bad-source-url', { ...bundle.context, sources: [{ provider: 'url', url: 'http://tickets.example.com/1' }] }],
      ['unknown-provider', { ...bundle.context, sources: [{ provider: 'mystery', url: 'https://tickets.example.com/x' }] }],
      ['bad-version', { ...bundle.context, version: 2 }],
    ] as const) {
      const invalid = replay(id);
      invalid.context = context as never;
      const rejected = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalid),
      });
      expect(rejected.status).toBe(400);
      expect((await fetch(`${endpoint}/${id}`)).status).toBe(404);
    }
  });

  it('returns a conflict instead of overwriting an uploaded replay', async () => {
    const { origin } = await start();
    const endpoint = `${origin}/api/replays`;
    const first = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay()),
    });
    const replacement = replay();
    replacement.meta.title = 'Replacement';
    const second = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replacement),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    const response = await fetch(`${endpoint}/test-replay`);
    await expect(response.json()).resolves.toMatchObject({ meta: { title: 'Test replay' } });
  });

  it('returns a conflict for replacement videos and sample replay videos', async () => {
    const { origin, store } = await start();
    await store.save(replay());
    const endpoint = `${origin}/api/replays/test-replay/video`;

    expect((await fetch(endpoint, { method: 'PUT', body: 'first' })).status).toBe(201);
    expect((await fetch(endpoint, { method: 'PUT', body: 'replacement' })).status).toBe(409);

    await mkdir(store.sampleDir, { recursive: true });
    await writeFile(join(store.sampleDir, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    expect((await fetch(`${origin}/api/replays/sample-replay/video`, { method: 'PUT', body: 'sample' })).status).toBe(409);
  });

  it('answers HEAD for a stored video and serves it as an MP4 attachment', async () => {
    const { origin, store } = await start();
    await store.save(replay());
    const endpoint = `${origin}/api/replays/test-replay/video`;
    expect((await fetch(endpoint, { method: 'HEAD' })).status).toBe(404);

    await store.saveVideo('test-replay', Buffer.from('mp4-bytes'));
    const head = await fetch(endpoint, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('video/mp4');
    expect(head.headers.get('content-length')).toBe('9');
    const response = await fetch(endpoint);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="test-replay.mp4"');
    await expect(response.text()).resolves.toBe('mp4-bytes');
  });

  it('rejects an upload whose title is not a string without breaking search', async () => {
    const { origin } = await start();
    const endpoint = `${origin}/api/replays`;
    const good = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay('kept-replay')),
    });
    const broken = replay('broken-title');
    (broken.meta as { title: unknown }).title = { text: 'nope' };
    const bad = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(broken),
    });
    const search = await fetch(`${endpoint}?q=test`);

    expect(good.status).toBe(201);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/title must be a string/);
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject([{ id: 'kept-replay' }]);
  });

  it('rejects cross-site uploads', async () => {
    const { origin } = await start();
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify(replay()),
    });
    expect(response.status).toBe(403);
  });
});

describe('replay index API', () => {
  it('filters summaries from query parameters', async () => {
    const { origin, store } = await start();
    const failing = replay('failing-run');
    failing.console.push({ at: 1, level: 'error', message: 'Boom' });
    await store.save(failing);
    await store.save(replay('quiet-run'));
    const list = async (query: string) =>
      ((await (await fetch(`${origin}/api/replays${query}`)).json()) as Array<{ id: string }>).map((item) => item.id).sort();
    await expect(list('')).resolves.toEqual(['failing-run', 'quiet-run']);
    await expect(list('?errors=1')).resolves.toEqual(['failing-run']);
    await expect(list('?q=quiet')).resolves.toEqual(['quiet-run']);
    await expect(list('?host=example.com&source=agent')).resolves.toEqual(['failing-run', 'quiet-run']);
    await expect(list('?source=human')).resolves.toEqual([]);
    await expect(list('?source=bogus')).resolves.toEqual(['failing-run', 'quiet-run']);
  });

  it('filters by tag', async () => {
    const { origin, store } = await start();
    const tagged = replay('tagged-run');
    tagged.meta.tags = ['smoke', 'checkout'];
    await store.save(tagged);
    await store.save(replay('untagged-run'));
    const ids = async (query: string) =>
      ((await (await fetch(`${origin}/api/replays${query}`)).json()) as Array<{ id: string }>).map((item) => item.id).sort();
    await expect(ids('?tag=smoke')).resolves.toEqual(['tagged-run']);
    await expect(ids('?tag=nothing')).resolves.toEqual([]);
    // Not a valid tag: ignored, like an unknown source.
    await expect(ids('?tag=NOT%20A%20TAG')).resolves.toEqual(['tagged-run', 'untagged-run']);
  });
});

const api = (origin: string, path: string) => `${origin}/api/${path}`;

const upload = (origin: string, id: string) =>
  fetch(api(origin, 'replays'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(replay(id)) });

describe('HTTP caching', () => {
  it('serves uploaded bundles as private and immutable, and revalidates committed samples', async () => {
    const { origin, store } = await start();
    expect((await upload(origin, 'cached-replay')).status).toBe(201);
    const uploaded = await fetch(api(origin, 'replays/cached-replay'));
    expect(uploaded.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    const etag = uploaded.headers.get('etag');
    expect(etag).toMatch(/^W\/".+"$/);
    expect((await fetch(api(origin, 'replays/cached-replay'), { headers: { 'if-none-match': etag! } })).status).toBe(304);

    await mkdir(store.sampleDir, { recursive: true });
    await writeFile(join(store.sampleDir, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    const sample = await fetch(api(origin, 'replays/sample-replay'));
    expect(sample.headers.get('cache-control')).toBe('private, no-cache');
    expect((await fetch(api(origin, 'replays/sample-replay'), { headers: { 'if-none-match': sample.headers.get('etag')! } })).status).toBe(
      304,
    );
  });

  it('tags lists with an ETag, answers 304 while unchanged and a fresh body once they change', async () => {
    const { origin } = await start();
    await upload(origin, 'first-replay');
    const list = await fetch(api(origin, 'replays'), { headers: { 'accept-encoding': 'br' } });
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('private, no-cache');
    const etag = list.headers.get('etag')!;
    expect(etag).toMatch(/^W\/".+"$/);
    const unchanged = await fetch(api(origin, 'replays'), { headers: { 'if-none-match': etag } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    await upload(origin, 'second-replay');
    const changed = await fetch(api(origin, 'replays'), { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    // The same entity, br or identity: the weak ETag does not depend on the encoding.
    expect((await fetch(api(origin, 'replays'))).headers.get('etag')).toBe(changed.headers.get('etag'));
  });

  it('revalidates a suite with its ETag and answers 304 while it is unchanged', async () => {
    const { origin, store } = await start();
    await store.registerSuite('review-7', {
      version: 1,
      id: 'review-7',
      title: 'Checkout review · PR #7',
      createdAt: '2026-10-10T12:00:00.000Z',
      subject: { provider: 'github', url: 'https://github.com/example-org/shop-demo/issues/7', ref: 'example-org/shop-demo#7' },
    });
    const suite = await fetch(api(origin, 'suites/review-7?expand=runs'));
    expect(suite.status).toBe(200);
    expect(suite.headers.get('cache-control')).toBe('private, no-cache');
    const etag = suite.headers.get('etag')!;
    expect((await fetch(api(origin, 'suites/review-7?expand=runs'), { headers: { 'if-none-match': etag } })).status).toBe(304);
    const missing = await fetch(api(origin, 'suites/review-8'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('etag')).toBeNull();
  });

  it('sends nothing no-store, /api/me included (pages stay eligible for the back/forward cache)', async () => {
    const { origin } = await start();
    expect((await fetch(api(origin, 'me'))).headers.get('cache-control')).toBe('private, no-cache');
    expect((await fetch(api(origin, 'replays/missing-replay'))).headers.get('cache-control')).toBe('private, no-cache');
    expect((await fetch(api(origin, 'replays/missing-replay/video'), { method: 'HEAD' })).headers.get('cache-control')).toBe(
      'private, no-cache',
    );
  });
});
