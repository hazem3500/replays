import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { TRASH_DAYS } from '../src/server/replay-meta.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { trashReceiptSchema } from '../src/shared/schemas/replay-meta.ts';
import { appDefaults, replay } from './fixtures.ts';

const DAY_MS = 86_400_000;

const servers: Array<ReturnType<typeof createServer>> = [];
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve) => server.close(() => resolve()));

async function listen(handle: ReturnType<typeof createApp>) {
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/** A server over an in-memory store holding `ids`, with a same-origin writer signed in as Ada. */
async function start(ids: readonly string[] = ['demo']) {
  const root = await mkdtemp(join(tmpdir(), 'replays-meta-'));
  const store = new ReplayStore(new MemoryStorage(), join(root, 'sample'));
  for (const id of ids) await store.save(replay(id));
  const origin = await listen(createApp({ ...appDefaults(), store, clientDir: root }));
  const write = (path: string, method: string, body?: unknown) =>
    fetch(`${origin}/api/${path}`, {
      method,
      headers: { origin, 'x-dev-user': 'ada@example.com', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const list = async (): Promise<unknown> => (await fetch(`${origin}/api/replays`)).json();
  return { origin, store, write, list };
}

describe('replay meta and trash API', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it('renames a replay, and the list shows and finds it under the new title', async () => {
    const app = await start();
    const renamed = await app.write('replays/demo/meta', 'PATCH', { title: 'Checkout regression' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: 'demo', title: 'Checkout regression' });
    expect(await (await fetch(`${app.origin}/api/replays?q=regression`)).json()).toMatchObject([{ id: 'demo' }]);
  });

  it('replaces the tags and serves the changes, with who made them, from GET …/meta', async () => {
    const app = await start();
    await app.write('replays/demo/meta', 'PATCH', { tags: ['checkout', 'flaky'] });
    expect(await (await fetch(`${app.origin}/api/replays?tag=flaky`)).json()).toMatchObject([{ id: 'demo', tags: ['checkout', 'flaky'] }]);
    expect(await (await fetch(`${app.origin}/api/replays/demo/meta`)).json()).toMatchObject({
      tags: ['checkout', 'flaky'],
      by: 'ada@example.com',
    });
  });

  it('answers an invalid change with 400 and the issues, changing nothing', async () => {
    const app = await start();
    const refused = await app.write('replays/demo/meta', 'PATCH', { tags: ['Not A Tag'] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'invalid replay meta', issues: [{ path: 'tags.0' }] });
    expect(await (await fetch(`${app.origin}/api/replays/demo/meta`)).json()).toEqual({});
  });

  it('refuses a purpose the deployment does not define', async () => {
    const app = await start();
    expect((await app.write('replays/demo/meta', 'PATCH', { purpose: 'nonsense' })).status).toBe(400);
  });

  it('moves a deleted replay out of the list and its bundle out of reach', async () => {
    const app = await start(['demo', 'other']);
    const deleted = await app.write('replays/demo', 'DELETE');
    expect(deleted.status).toBe(200);
    expect(trashReceiptSchema.parse(await deleted.json()).id).toBe('demo');
    expect(await app.list()).toMatchObject([{ id: 'other' }]);
    expect((await fetch(`${app.origin}/api/replays/demo`)).status).toBe(404);
  });

  it('restores a deleted replay into the list', async () => {
    const app = await start();
    await app.write('replays/demo', 'DELETE');
    const restored = await app.write('replays/demo/restore', 'POST');
    expect(restored.status).toBe(200);
    expect(await app.list()).toMatchObject([{ id: 'demo' }]);
  });

  it('refuses to delete a kept replay until Keep is released', async () => {
    const app = await start();
    await app.write('replays/demo/keep', 'PUT');
    expect((await app.write('replays/demo', 'DELETE')).status).toBe(409);
  });

  it('sweeps a replay that stayed in the trash longer than the window', async () => {
    const app = await start();
    await app.write('replays/demo', 'DELETE');
    await app.store.prune(Date.now() + (TRASH_DAYS + 1) * DAY_MS);
    expect((await app.write('replays/demo/restore', 'POST')).status).toBe(404);
  });

  it('keeps the routes behind the same-origin check for writes', async () => {
    const app = await start();
    const crossSite = await fetch(`${app.origin}/api/replays/demo`, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
  });

  it('answers 404 for an unknown replay and 405 with Allow for other methods', async () => {
    const app = await start();
    expect((await app.write('replays/missing/meta', 'PATCH', { title: 'x' })).status).toBe(404);
    const other = await app.write('replays/demo/meta', 'PUT', { title: 'x' });
    expect([other.status, other.headers.get('allow')]).toEqual([405, 'GET, HEAD, PATCH']);
  });

  it('leaves GET of the bundle to the bundle route', async () => {
    const app = await start();
    expect(await (await fetch(`${app.origin}/api/replays/demo`)).json()).toMatchObject({ meta: { id: 'demo' } });
  });
});
