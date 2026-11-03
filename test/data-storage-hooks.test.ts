import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, resolvePluginsSync } from '../src/plugin/index.ts';
import { bulkTrashResultSchema, dataStorageSchema } from '../src/shared/data-storage.ts';
import { closeDataStorageServers, startDataStorage } from './data-storage-fixture.ts';
import { replay } from './fixtures.ts';

const phases = ['pre-auth', 'post-auth'] as const;
const styles = ['node', 'web'] as const;
const confirmation = JSON.stringify({ confirm: 'trash-all' });
const bulk = (origin: string) =>
  fetch(`${origin}/api/data-storage/trash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: confirmation,
  });

describe('data storage canonical request hooks', () => {
  afterEach(closeDataStorageServers);
  for (const phase of phases) {
    for (const style of styles) {
      it(`preserves ${style} ${phase} DELETE restrictions during bulk trash`, async () => {
        const plugins = resolvePluginsSync([
          definePlugin({
            name: 'protect-private',
            setup(api) {
              if (style === 'node')
                api.onRequest(
                  ({ request, response, path }) => {
                    if (request.method !== 'DELETE' || path !== '/api/replays/private') return;
                    response.writeHead(403).end('private');
                    return true;
                  },
                  { phase },
                );
              else
                api.middleware({
                  phase,
                  handle: ({ request, path }) =>
                    request.method === 'DELETE' && path === '/api/replays/private' ? new Response('private', { status: 403 }) : undefined,
                });
            },
          }),
        ]);
        const { origin, store } = await startDataStorage({ plugins });
        await store.save(replay('private'));
        expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE' })).status).toBe(403);
        expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json())).toEqual({
          trashed: 0,
          protected: 0,
          unavailable: 0,
          failed: 0,
        });
        expect(dataStorageSchema.parse(await (await fetch(`${origin}/api/data-storage`)).json()).replayCount).toBe(0);
        expect(await store.load('private')).toBeDefined();
        expect(await store.storage.list({ glob: 'private/trash.json' })).toEqual([]);
      });

      it(`omits private trash IDs denied by ${style} ${phase} GET hooks`, async () => {
        const plugins = resolvePluginsSync([
          definePlugin({
            name: 'hide-private',
            setup(api) {
              if (style === 'node')
                api.onRequest(
                  ({ request, response, path }) => {
                    if (request.method !== 'GET' || path !== '/api/replays/private') return;
                    response.writeHead(403).end('private');
                    return true;
                  },
                  { phase },
                );
              else
                api.middleware({
                  phase,
                  handle: ({ request, path }) =>
                    request.method === 'GET' && path === '/api/replays/private' ? new Response('private', { status: 403 }) : undefined,
                });
            },
          }),
        ]);
        const { origin, store } = await startDataStorage({ plugins });
        await store.save(replay('private'));
        await store.trash('private', 'ada');
        expect((await fetch(`${origin}/api/replays/private`)).status).toBe(403);
        const response = await fetch(`${origin}/api/data-storage`);
        expect(response.status).toBe(200);
        expect(await response.clone().text()).not.toContain('private');
        expect(dataStorageSchema.parse(await response.json()).trash).toEqual([]);
      });
    }
  }
});

async function canonicalOrder() {
  const seen: string[] = [];
  const originals: Array<{ method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders }> = [];
  const requests: IncomingMessage[] = [];
  const plugins = resolvePluginsSync([
    definePlugin({
      name: 'ordered',
      setup(api) {
        api.identity({
          resolve: (identity, { request }) => {
            if (request.url === '/review/api/replays/visible') seen.push(`${request.method}:identity`);
            return identity;
          },
        });
        api.requestPolicy({ path: '/api/replays/visible', methods: ['GET', 'DELETE'], origins: ['https://trusted.example'], headers: [] });
        for (const phase of phases) {
          api.onRequest(
            ({ request, response, path, identity }) => {
              if (path === '/api/data-storage/trash' && phase === 'pre-auth') {
                requests.push(request);
                originals.push({ method: request.method, url: request.url, headers: structuredClone(request.headers) });
              }
              if (path !== '/api/replays/visible') return;
              expect(request.url).toBe('/review/api/replays/visible');
              expect(request.headers['content-type']).toBeUndefined();
              expect(response.getHeader('vary')).toContain('Origin');
              expect(identity?.id).toBe(phase === 'post-auth' ? 'anonymous' : undefined);
              seen.push(`${request.method}:node:${phase}`);
            },
            { phase },
          );
          api.middleware({
            phase,
            handle: ({ request, path, base, url }) => {
              if (path !== '/api/replays/visible') return;
              expect(base).toBe('/review');
              expect(url.pathname).toBe('/review/api/replays/visible');
              expect(new URL(request.url).pathname).toBe('/review/api/replays/visible');
              seen.push(`${request.method}:web:${phase}`);
            },
          });
        }
      },
    }),
  ]);
  const { origin, store } = await startDataStorage({
    plugins,
    basePath: '/review',
    auth: {
      name: 'ordered',
      authenticate: (request) => {
        if (request.url === '/review/api/replays/visible') seen.push(`${request.method}:authenticate`);
        return { id: 'anonymous' };
      },
    },
    authorize: (request, path) => {
      if (path === '/api/replays/visible') seen.push(`${request.method}:authorize`);
      return Promise.resolve();
    },
  });
  await store.save(replay('visible'));
  expect(bulkTrashResultSchema.parse(await (await bulk(`${origin}/review`)).json()).trashed).toBe(1);
  expect(seen).toEqual(
    ['GET', 'DELETE'].flatMap((method) => [
      `${method}:node:pre-auth`,
      `${method}:web:pre-auth`,
      `${method}:authenticate`,
      `${method}:identity`,
      `${method}:authorize`,
      `${method}:node:post-auth`,
      `${method}:web:post-auth`,
    ]),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers).toEqual(originals[0]?.headers);
  expect(requests[0]?.method).toBe('POST');
  expect(requests[0]?.url).toBe('/review/api/data-storage/trash');
}

async function bulkCsrf() {
  const plugins = resolvePluginsSync([
    definePlugin({
      name: 'bulk-cors',
      setup(api) {
        api.requestPolicy({ path: '/api/data-storage/trash', methods: ['POST'], origins: ['https://trusted.example'], headers: [] });
      },
    }),
  ]);
  const { store, origin } = await startDataStorage({ plugins });
  await store.save(replay('private'));
  const headers = { 'content-type': 'application/json', origin: 'https://trusted.example', 'sec-fetch-site': 'cross-site' };
  expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE', headers })).status).toBe(403);
  const response = await fetch(`${origin}/api/data-storage/trash`, { method: 'POST', headers, body: confirmation });
  expect(response.status).toBe(200);
  expect(bulkTrashResultSchema.parse(await response.json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

async function handledMiddleware() {
  const plugins = resolvePluginsSync([
    definePlugin({
      name: 'no-delete',
      setup(api) {
        api.middleware({
          phase: 'post-auth',
          handle: ({ request, path }) =>
            request.method === 'DELETE' && path === '/api/replays/private' ? new Response('handled') : undefined,
        });
      },
    }),
  ]);
  const { store, origin } = await startDataStorage({ plugins });
  await store.save(replay('private'));
  expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE' })).status).toBe(200);
  expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

async function derivedAuthentication() {
  const { store, origin } = await startDataStorage({
    auth: {
      name: 'route-sensitive',
      authenticate: (request) => (request.method === 'DELETE' ? undefined : { id: 'ada' }),
    },
  });
  await store.save(replay('private'));
  expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE' })).status).toBe(403);
  expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

async function identityMismatch() {
  const { store, origin } = await startDataStorage({
    auth: {
      name: 'route-sensitive',
      authenticate: (request) => ({ id: request.method === 'DELETE' ? 'different-person' : 'ada' }),
    },
  });
  await store.save(replay('private'));
  expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

async function derivedScope() {
  const { store, origin } = await startDataStorage({
    auth: {
      name: 'route-sensitive',
      authenticate: (request) => ({ id: 'ada', ...(request.method === 'DELETE' ? { capabilities: { routes: [] } } : {}) }),
    },
  });
  await store.save(replay('private'));
  expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE' })).status).toBe(403);
  expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

async function privateGet() {
  const { store, origin } = await startDataStorage({
    auth: {
      name: 'route-sensitive',
      authenticate: (request) => (request.url === '/api/replays/private' ? undefined : { id: 'ada' }),
    },
  });
  await store.save(replay('private'));
  await store.trash('private', 'ada');
  expect((await fetch(`${origin}/api/replays/private`)).status).toBe(403);
  const response = await fetch(`${origin}/api/data-storage`);
  expect(response.status).toBe(200);
  expect(await response.clone().text()).not.toContain('private');
  expect(dataStorageSchema.parse(await response.json()).trash).toEqual([]);
}

async function adapterOwnedRoutes() {
  const { store, origin } = await startDataStorage({
    auth: {
      name: 'intercepting',
      routes: ['/api/replays/private'],
      authenticate: () => ({ id: 'ada' }),
      handle: (request, response) => {
        if (request.method !== 'DELETE') return false;
        response.writeHead(403).end('private');
        return true;
      },
    },
  });
  await store.save(replay('private'));
  expect((await fetch(`${origin}/api/replays/private`, { method: 'DELETE' })).status).toBe(403);
  expect(bulkTrashResultSchema.parse(await (await bulk(origin)).json()).trashed).toBe(0);
  expect(await store.load('private')).toBeDefined();
}

describe('data storage derived authorization', () => {
  afterEach(closeDataStorageServers);
  it('preserves canonical phase order, base paths and the original request during derived checks', canonicalOrder);
  it('does not promote the bulk route CSRF exception into individual DELETE permission', bulkCsrf);
  it('treats successful middleware short circuits as handled requests rather than deletion grants', handledMiddleware);
  it('reauthenticates each DELETE through the adapter even when the outer bulk request is authenticated', derivedAuthentication);
  it('rejects a derived request that authenticates as a different person', identityMismatch);
  it('enforces the scope of the freshly authenticated identity rather than the broader outer identity', derivedScope);
  it('hides trash IDs when the adapter refuses the corresponding GET', privateGet);
  it('honors adapter-owned routes that intercept a replay request before authentication', adapterOwnedRoutes);
});
