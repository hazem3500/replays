import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, rejectUpload, resolvePlugins, type PluginApi } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { mergeContextSchemas } from '../src/server/runtime.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const plugin = (name: string, setup: (api: PluginApi) => void, extra: { order?: number } = {}) => definePlugin({ name, setup, ...extra });

async function start(plugins: ReturnType<typeof plugin>[], options: { signedIn?: (token: string | undefined) => boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replays-plugin-app-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(
    join(root, 'client', 'index.html'),
    '<!doctype html><html><head><meta name="app-base" content="" /><meta name="app-plugins" content="" /><title>__PRODUCT_NAME__</title></head><body></body></html>',
  );
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const registry = await resolvePlugins(plugins);
  const defaults = appDefaults();
  const sources = defaults.sources;
  for (const provider of registry.sourceProviders) sources.register(provider.value);
  const contextSchema = mergeContextSchemas(undefined, registry);
  const handle = createApp({
    ...defaults,
    auth: {
      name: 'token',
      authenticate: (request) => {
        const token = request.headers['x-token'];
        return options.signedIn
          ? options.signedIn(typeof token === 'string' ? token : undefined)
            ? { id: String(token) }
            : undefined
          : { id: 'tester' };
      },
    },
    sources,
    store,
    clientDir: join(root, 'client'),
    plugins: registry,
    ...(contextSchema ? { contextSchema } : {}),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { origin: `http://127.0.0.1:${address.port}`, store, root };
}

const post = (origin: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const adapter = (api: PluginApi) =>
  api.contextAdapter({
    name: 'stamp',
    schema: { type: 'object', properties: { uploader: { type: 'string', title: 'Uploader' } }, required: ['uploader'] },
    normalize: (context, { identity, kind, request }) => ({
      version: 1,
      capturedAt: context?.capturedAt ?? '2026-10-10T12:00:00.000Z',
      ...context,
      fields: { ...context?.fields, uploader: identity.id, kind, via: String(request.headers['x-via'] ?? '') },
    }),
  });

describe('request hooks', () => {
  it('run post-auth by default, in plugin order, and stop at the first that answers', async () => {
    const calls: string[] = [];
    const { origin } = await start([
      plugin(
        'b',
        (api) =>
          api.onRequest(({ response }) => {
            calls.push('b');
            response.writeHead(200);
            response.end('from b');
            return true;
          }),
        { order: 2 },
      ),
      plugin(
        'a',
        (api) =>
          api.onRequest(({ path, identity }) => {
            calls.push(`a:${path}:${identity?.id}`);
          }),
        { order: 1 },
      ),
    ]);
    const response = await fetch(`${origin}/api/anything`);
    expect(await response.text()).toBe('from b');
    expect(calls).toEqual(['a:/api/anything:tester', 'b']);
  });

  it('pre-auth hooks see unauthenticated requests; post-auth hooks never do', async () => {
    const seen: string[] = [];
    const { origin } = await start(
      [
        plugin('p', (api) => {
          api.onRequest(
            ({ response, path }) => {
              if (path !== '/_ping') return;
              response.writeHead(200);
              response.end('pong');
              return true;
            },
            { phase: 'pre-auth' },
          );
          api.onRequest(({ path }) => void seen.push(path));
        }),
      ],
      { signedIn: () => false },
    );
    expect(await (await fetch(`${origin}/_ping`)).text()).toBe('pong');
    expect((await fetch(`${origin}/api/replays`)).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('do not see the health check', async () => {
    let calls = 0;
    const { origin } = await start([plugin('p', (api) => api.onRequest(() => void (calls += 1), { phase: 'pre-auth' }))]);
    expect(await (await fetch(`${origin}/healthz`)).text()).toBe('ok');
    expect(calls).toBe(0);
  });
});

describe('response hooks', () => {
  it('get method, path, status, duration and identity once the response is done; their errors do not matter', async () => {
    const infos: unknown[] = [];
    const { origin } = await start([
      plugin('p', (api) => {
        api.onResponse((info) => void infos.push(info));
        api.onResponse(() => {
          throw new Error('hook bug');
        });
      }),
    ]);
    expect((await fetch(`${origin}/api/nope`)).status).toBe(404);
    await expect.poll(() => infos.length).toBe(1);
    expect(infos[0]).toMatchObject({ method: 'GET', path: '/api/nope', status: 404, identity: { id: 'tester' } });
    expect((infos[0] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('record unauthenticated refusals too, without an identity', async () => {
    const infos: Array<{ status: number; identity?: unknown }> = [];
    const { origin } = await start([plugin('p', (api) => api.onResponse((info) => void infos.push(info)))], { signedIn: () => false });
    await fetch(`${origin}/api/replays`);
    await expect.poll(() => infos.length).toBe(1);
    expect(infos[0]).toMatchObject({ status: 403 });
    expect(infos[0]?.identity).toBeUndefined();
  });
});

describe('upload lifecycle', () => {
  it('beforeUpload can refuse with a status, afterUpload runs after the save, and an afterUpload error does not fail the upload', async () => {
    const after: string[] = [];
    const { origin, store } = await start([
      plugin('p', (api) => {
        api.beforeUpload(({ bundle }) => {
          if (bundle.meta.title.includes('banned')) throw rejectUpload(451, 'banned title');
        });
        api.afterUpload(async ({ bundle, identity, url }) => {
          after.push(`${bundle.meta.id}:${identity.id}:${url}:${Boolean(await store.load(bundle.meta.id))}`);
          throw new Error('notification service down');
        });
      }),
    ]);
    const refused = await post(origin, { ...replay('r-banned'), meta: { ...replay().meta, id: 'r-banned', title: 'banned replay' } });
    expect(refused.status).toBe(451);
    expect(await refused.text()).toBe('banned title');
    expect(await store.load('r-banned')).toBeUndefined();

    const accepted = await post(origin, replay('r-ok'));
    expect(accepted.status).toBe(201);
    expect(after).toEqual(['r-ok:tester:/r/r-ok:true']);
  });

  it('beforeUpload runs hooks in order and may replace the bundle; a replacement is validated again', async () => {
    const { origin, store } = await start([
      plugin('a', (api) => api.beforeUpload(({ bundle }) => ({ ...bundle, meta: { ...bundle.meta, title: `${bundle.meta.title} + a` } })), {
        order: 1,
      }),
      plugin('b', (api) => api.beforeUpload(({ bundle }) => ({ ...bundle, meta: { ...bundle.meta, title: `${bundle.meta.title} + b` } })), {
        order: 2,
      }),
    ]);
    expect((await post(origin, replay('r-chain'))).status).toBe(201);
    expect((await store.load('r-chain'))?.meta.title).toBe('Test replay + a + b');

    const { origin: broken } = await start([plugin('bad', (api) => api.beforeUpload(() => ({ nothing: true }) as never))]);
    expect((await post(broken, replay('r-broken'))).status).toBe(400);
  });

  it('runs for the import endpoint too', async () => {
    const titles: string[] = [];
    const { origin } = await start([plugin('p', (api) => api.beforeUpload(({ bundle }) => void titles.push(bundle.meta.title)))]);
    const events = replay().events;
    const response = await fetch(`${origin}/api/replays/import?title=Imported%20by%20hook&url=https%3A%2F%2Fexample.com%2F`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(events),
    });
    expect(response.status).toBe(201);
    expect(titles).toEqual(['Imported by hook']);
  });
});

describe('prepareUpload hooks', () => {
  it('translate the raw body before validation, in order, and the result is still validated', async () => {
    const { origin, store } = await start([
      plugin(
        'a',
        (api) =>
          api.prepareUpload(({ body }) => ({
            ...(body as object),
            meta: { ...(body as { meta: object }).meta, title: 'Legacy title', legacy: undefined },
          })),
        { order: 1 },
      ),
      plugin(
        'b',
        (api) =>
          api.prepareUpload(({ body, identity }) => ({
            ...(body as object),
            context: { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', fields: { by: identity.id } },
          })),
        { order: 2 },
      ),
    ]);
    // A foreign `meta.source` is refused by the core; the translating hook maps it to `agent`.
    const legacy = { ...replay('r-legacy'), meta: { ...replay().meta, id: 'r-legacy', source: 'runner' } };
    expect((await post(origin, legacy)).status).toBe(400);
    const { origin: translated } = await start([
      plugin('t', (api) =>
        api.prepareUpload(({ body }) => {
          const { source, ...meta } = (body as { meta: Record<string, unknown> }).meta;
          return {
            ...(body as object),
            meta: { ...meta, source: source === 'runner' ? 'agent' : source, tags: [`from:${String(source)}`] },
          };
        }),
      ),
    ]);
    expect((await post(translated, legacy)).status).toBe(201);
    expect((await (await fetch(`${translated}/api/replays/r-legacy`)).json()).meta).toMatchObject({
      source: 'agent',
      tags: ['from:runner'],
    });

    expect((await post(origin, replay('r-chain2'))).status).toBe(201);
    const stored = await store.load('r-chain2');
    expect(stored?.meta.title).toBe('Legacy title');
    expect(stored?.context?.fields).toEqual({ by: 'tester' });
  });

  it('cannot get an invalid body past validation', async () => {
    const { origin } = await start([plugin('p', (api) => api.prepareUpload(() => ({ nothing: true })))]);
    expect((await post(origin, replay('r-nope'))).status).toBe(400);
  });
});

describe('context adapters', () => {
  it('create or complete the context on upload, and the merged schema is enforced on the result', async () => {
    const { origin, store } = await start([plugin('p', adapter)]);
    expect((await post(origin, replay('r-ctx'), { 'x-via': 'proxy' })).status).toBe(201);
    expect((await store.load('r-ctx'))?.context?.fields).toEqual({ uploader: 'tester', kind: 'replay', via: 'proxy' });
  });

  it('resolve sources an adapter adds as references', async () => {
    const { origin, store } = await start([
      plugin('p', (api) => {
        api.sourceProvider({ id: 'tick', label: 'Tickets', resolve: (ref) => ({ url: `https://tickets.example.com/${ref}`, label: ref }) });
        api.contextAdapter({
          name: 'link',
          normalize: (context) => ({
            version: 1,
            capturedAt: '2026-10-10T12:00:00.000Z',
            ...context,
            sources: [{ provider: 'tick', ref: 'T-9' } as never],
          }),
        });
      }),
    ]);
    expect((await post(origin, replay('r-src'))).status).toBe(201);
    expect((await store.load('r-src'))?.context?.sources).toEqual([
      { provider: 'tick', ref: 'T-9', url: 'https://tickets.example.com/T-9', label: 'T-9' },
    ]);
  });

  it('refuse an upload whose adapted context breaks the schema; adapters run in order', async () => {
    const order: string[] = [];
    const { origin } = await start([
      plugin('p', (api) => {
        api.contextAdapter({ name: 'first', normalize: (context) => (order.push('first'), context) });
        api.contextAdapter({
          name: 'second',
          schema: { type: 'object', properties: { n: { type: 'number' } } },
          normalize: (context) => (
            order.push('second'), { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', ...context, fields: { n: 'not a number' } }
          ),
        });
      }),
    ]);
    const response = await post(origin, replay('r-bad'));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/context\.fields\.n/);
    expect(order).toEqual(['first', 'second']);
  });

  it('turn an adapter crash into a 500 without leaking its message, and keep an adapter’s own status', async () => {
    const { origin } = await start([
      plugin('p', (api) =>
        api.contextAdapter({
          name: 'boom',
          normalize: () => {
            throw new Error('secret detail');
          },
        }),
      ),
    ]);
    const crashed = await post(origin, replay('r-crash'));
    expect(crashed.status).toBe(500);
    expect(await crashed.text()).not.toContain('secret detail');
    const { origin: denied } = await start([
      plugin('p', (api) =>
        api.contextAdapter({
          name: 'deny',
          normalize: () => {
            throw rejectUpload(403, 'not your project');
          },
        }),
      ),
    ]);
    const response = await post(denied, replay('r-deny'));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('not your project');
  });

  it('apply to suite registrations', async () => {
    const { origin } = await start([plugin('p', adapter)]);
    const suite = { version: 1, id: 's1', title: 'Suite', createdAt: '2026-10-10T12:00:00.000Z' };
    const response = await fetch(`${origin}/api/suites/s1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(suite),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).context.fields).toMatchObject({ uploader: 'tester', kind: 'suite' });
  });
});

describe('client entries', () => {
  it('are listed in the page, served behind auth with the right type, and unknown files 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-client-'));
    const script = join(dir, 'entry.js');
    const style = join(dir, 'entry.css');
    await writeFile(script, 'export default () => {};\n');
    await writeFile(style, 'body{}\n');
    const { origin } = await start(
      [
        plugin('acme', (api) => {
          api.client({ id: 'main', script, style });
          api.client({ id: 'remote', script: 'https://cdn.example.com/x.js' });
        }),
      ],
      { signedIn: (token) => token === 'ok' },
    );
    const page = await fetch(`${origin}/`, { headers: { accept: 'text/html', 'x-token': 'ok' } });
    const html = await page.text();
    const meta = /<meta name="app-plugins" content="([^"]*)"/.exec(html)![1]!.replaceAll('&quot;', '"');
    expect(JSON.parse(meta)).toEqual([
      { plugin: 'acme', id: 'main', script: '/_plugins/acme/main.js', style: '/_plugins/acme/main.css' },
      { plugin: 'acme', id: 'remote', script: 'https://cdn.example.com/x.js' },
    ]);

    expect((await fetch(`${origin}/_plugins/acme/main.js`)).status).toBe(403);
    const served = await fetch(`${origin}/_plugins/acme/main.js`, { headers: { 'x-token': 'ok' } });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(served.headers.get('cache-control')).toBe('private, no-cache');
    expect(await served.text()).toContain('export default');
    expect((await fetch(`${origin}/_plugins/acme/main.css`, { headers: { 'x-token': 'ok' } })).headers.get('content-type')).toBe(
      'text/css; charset=utf-8',
    );
    for (const path of ['_plugins/acme/other.js', '_plugins/ghost/main.js', '_plugins/acme/remote.js', '_plugins/acme/../../etc/passwd']) {
      expect((await fetch(`${origin}/${path}`, { headers: { 'x-token': 'ok' } })).status).toBe(404);
    }
  });

  it('leave the page untouched without plugins, and /api/config lists the plugin names', async () => {
    const { origin } = await start([]);
    const html = await (await fetch(`${origin}/`, { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('<meta name="app-plugins" content="" />');
    const { origin: withPlugin } = await start([plugin('acme', () => {})]);
    expect((await (await fetch(`${withPlugin}/api/config`)).json()).plugins).toEqual(['acme']);
  });
});
