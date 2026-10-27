import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { TRASH_DAYS, trashRecordSchema } from '../src/shared/schemas/replay-meta.ts';
import { appDefaults, replay } from './fixtures.ts';

const DAY = 24 * 60 * 60_000;
const servers: Array<ReturnType<typeof createServer>> = [];

const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve) => server.close(() => resolve()));
const read = async (response: Response): Promise<unknown> => response.json();
const issuesSchema = z.object({ error: z.string(), issues: z.array(z.object({ path: z.string(), message: z.string() })) });
const trashedSchema = z.object({ trashed: trashRecordSchema, restorableUntil: z.string() });

/** An app over an in-memory store holding the replay `demo`, and the requests these tests make of it. */
async function start() {
  const root = await mkdtemp(join(tmpdir(), 'replays-meta-'));
  const store = new ReplayStore(new MemoryStorage(), join(root, 'sample'));
  const handle = createApp({ ...appDefaults(), store, clientDir: root });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  await store.save(replay('demo'));
  const api = `${origin}/api`;
  const headers = { origin, 'content-type': 'application/json', 'x-dev-user': 'ada@example.com' };
  return {
    api,
    store,
    headers,
    patch: (body: unknown) => fetch(`${api}/replays/demo/meta`, { method: 'PATCH', headers, body: JSON.stringify(body) }),
    remove: () => fetch(`${api}/replays/demo`, { method: 'DELETE', headers }),
    restore: () => fetch(`${api}/replays/demo/restore`, { method: 'POST', headers }),
    listed: async () => read(await fetch(`${api}/replays`)),
  };
}

const closeAll = async () => {
  await Promise.all(servers.splice(0).map(close));
};

describe('replay meta API', () => {
  afterEach(closeAll);

  it('renames a replay and retags it, and the list shows the change', async () => {
    const { patch, listed } = await start();
    const response = await patch({ title: '  Checkout with a bad coupon  ', tags: ['checkout', 'bug'] });
    expect(response.status).toBe(200);
    expect(await read(response)).toMatchObject({ id: 'demo', title: 'Checkout with a bad coupon', tags: ['checkout', 'bug'] });
    expect(await listed()).toMatchObject([{ id: 'demo', title: 'Checkout with a bad coupon', tags: ['checkout', 'bug'] }]);
  });

  it('keeps earlier changes when a later patch changes something else', async () => {
    const { patch } = await start();
    await patch({ title: 'Renamed' });
    expect(await read(await patch({ tags: ['later'] }))).toMatchObject({ title: 'Renamed', tags: ['later'] });
  });

  it('leaves the stored bundle as uploaded', async () => {
    const { api, patch } = await start();
    await patch({ title: 'Renamed' });
    expect(await read(await fetch(`${api}/replays/demo`))).toMatchObject({ meta: { title: 'Test replay' } });
  });

  it('refuses an invalid body with 400 and the issues', async () => {
    const { patch } = await start();
    const response = await patch({ title: '', tags: ['Not A Tag'], extra: true });
    expect(response.status).toBe(400);
    const body = issuesSchema.parse(await read(response));
    expect(body.error).toBe('invalid replay meta');
    expect(body.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['title', 'tags.0']));
  });

  it('refuses an empty patch and a purpose the deployment does not define', async () => {
    const { patch } = await start();
    expect([(await patch({})).status, (await patch({ purpose: 'not-a-purpose' })).status]).toEqual([400, 400]);
  });

  it('refuses malformed JSON with 400', async () => {
    const { api, headers } = await start();
    expect((await fetch(`${api}/replays/demo/meta`, { method: 'PATCH', headers, body: '{' })).status).toBe(400);
  });

  it('answers 404 for an unknown replay', async () => {
    const { api, headers } = await start();
    const response = await fetch(`${api}/replays/missing/meta`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'x' }) });
    expect(response.status).toBe(404);
  });

  it('refuses cross-site writes', async () => {
    const { api } = await start();
    const headers = { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' };
    const statuses = [
      (await fetch(`${api}/replays/demo/meta`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'x' }) })).status,
      (await fetch(`${api}/replays/demo`, { method: 'DELETE', headers })).status,
      (await fetch(`${api}/replays/demo/restore`, { method: 'POST', headers })).status,
    ];
    expect(statuses).toEqual([403, 403, 403]);
  });
});

describe('replay delete and restore API', () => {
  afterEach(closeAll);

  it('soft-deletes a replay and says until when it can be restored', async () => {
    const { remove } = await start();
    const response = await remove();
    expect(response.status).toBe(200);
    const body = trashedSchema.parse(await read(response));
    expect(Date.parse(body.restorableUntil) - Date.parse(body.trashed.at)).toBe(TRASH_DAYS * DAY);
    expect(body.trashed.by).toBe('ada@example.com');
  });

  it('takes a deleted replay out of the list and answers 404 for its bundle', async () => {
    const { api, remove, listed } = await start();
    await remove();
    expect([await listed(), (await fetch(`${api}/replays/demo`)).status]).toEqual([[], 404]);
  });

  it('restores a deleted replay', async () => {
    const { remove, restore, listed } = await start();
    await remove();
    expect((await restore()).status).toBe(200);
    expect(await listed()).toMatchObject([{ id: 'demo' }]);
  });

  it('answers 404 when restoring a replay that is not deleted', async () => {
    const { restore } = await start();
    expect((await restore()).status).toBe(404);
  });

  it('refuses to delete a kept replay with 409', async () => {
    const { api, headers, remove } = await start();
    await fetch(`${api}/replays/demo/keep`, { method: 'PUT', headers });
    expect((await remove()).status).toBe(409);
  });

  it('keeps a deleted replay restorable until its window has passed', async () => {
    const { store } = await start();
    await store.trash('demo', 'ada@example.com');
    expect(await store.prune(Date.now() + (TRASH_DAYS - 1) * DAY)).not.toContain('demo');
  });

  it('removes a deleted replay for good once its restore window has passed', async () => {
    const { store } = await start();
    await store.trash('demo', 'ada@example.com');
    expect(await store.prune(Date.now() + (TRASH_DAYS + 1) * DAY)).toContain('demo');
  });
});
