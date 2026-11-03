import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryStorage } from '../src/server/storage/index.ts';
import { NotFoundError, type WriteOptions } from '../src/server/storage/types.ts';
import { bulkTrashResultSchema, dataStorageSchema } from '../src/shared/data-storage.ts';
import { HttpError } from '../src/shared/http-error.ts';
import { startDataStorage, closeDataStorageServers } from './data-storage-fixture.ts';
import { replay } from './fixtures.ts';

const body = JSON.stringify({ confirm: 'trash-all' });
const post = (origin: string, overrides: RequestInit = {}) =>
  fetch(`${origin}/api/data-storage/trash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    ...overrides,
  });

class InterruptedStorage extends MemoryStorage {
  active = 0;
  peak = 0;
  override async write(key: string, value: Buffer | string, options?: WriteOptions) {
    if (!key.endsWith('/trash.json')) return super.write(key, value, options);
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      await Promise.resolve();
      if (key === 'gone/trash.json') throw new NotFoundError(key);
      if (key === 'failed/trash.json') throw new TypeError('private provider diagnostic');
      return await super.write(key, value, options);
    } finally {
      this.active--;
    }
  }
}

describe('bulk replay trash', () => {
  afterEach(closeDataStorageServers);
  it('moves active uploads to reversible trash while preserving committed samples and both kinds of keeps', async () => {
    const { store, origin, samples } = await startDataStorage();
    for (const id of ['active', 'kept', 'suite-run', 'already-deleted']) await store.save(replay(id));
    await store.trash('already-deleted', 'ada');
    await store.keep('kept', 'ada');
    const timestamp = new Date().toISOString();
    await store.registerSuite('kept-suite', { version: 1, id: 'kept-suite', title: 'Protected review', createdAt: timestamp });
    await store.registerRun('kept-suite', 'run', { id: 'run', sequence: 1, label: 'Run', status: 'passed', startedAt: timestamp });
    await store.attachReplay('kept-suite', 'run', replay('suite-run'));
    await store.keepSuite('kept-suite', 'ada');
    await writeFile(join(samples, 'sample.json'), JSON.stringify(replay('sample')));
    const before = dataStorageSchema.parse(await (await fetch(`${origin}/api/data-storage`)).json());
    expect(before.replayCount).toBe(3);
    const response = await post(origin);
    expect(response.status).toBe(200);
    expect(bulkTrashResultSchema.parse(await response.json())).toEqual({ trashed: 1, protected: 2, unavailable: 0, failed: 0 });
    expect(await store.storage.read('active/replay.json')).toBeDefined();
    expect((await store.list()).map((entry) => entry.id)).toEqual(expect.arrayContaining(['kept', 'suite-run', 'sample']));
    await store.restore('active');
    expect(await store.load('active')).toMatchObject({ meta: { id: 'active' } });
  });

  it('excludes read-denied and delete-denied uploads from counts and mutations', async () => {
    const { store, origin } = await startDataStorage({
      authorize: (request, path) => {
        if (path === '/api/replays/private' || (request.method === 'DELETE' && path === '/api/replays/read-only'))
          throw new HttpError(403, 'not allowed');
        return Promise.resolve();
      },
    });
    for (const id of ['visible', 'private', 'read-only']) await store.save(replay(id));
    expect(dataStorageSchema.parse(await (await fetch(`${origin}/api/data-storage`)).json()).replayCount).toBe(1);
    const response = await post(origin);
    expect(await response.clone().text()).not.toMatch(/private|read-only/);
    const result = bulkTrashResultSchema.parse(await response.json());
    expect(result).toEqual({ trashed: 1, protected: 0, unavailable: 0, failed: 0 });
    expect(JSON.stringify(result)).not.toContain('private');
    expect((await store.list()).map((entry) => entry.id)).toEqual(expect.arrayContaining(['private', 'read-only']));
  });

  it('cannot escalate a token that is granted the bulk route but lacks individual replay grants', async () => {
    const { store, origin } = await startDataStorage({
      auth: {
        name: 'narrow',
        authenticate: () => ({
          id: 'agent',
          capabilities: {
            routes: [{ method: 'POST', path: '/api/data-storage/trash' }],
          },
        }),
      },
    });
    await store.save(replay('not-granted'));
    const response = await post(origin);
    expect(response.status).toBe(200);
    expect(bulkTrashResultSchema.parse(await response.json())).toEqual({ trashed: 0, protected: 0, unavailable: 0, failed: 0 });
    expect(await store.load('not-granted')).toBeDefined();
  });

  it('requires explicit valid confirmation before changing any replay', async () => {
    const { store, origin } = await startDataStorage();
    await store.save(replay('active'));
    expect((await post(origin, { body: '{}' })).status).toBe(400);
    expect((await post(origin, { body: '{' })).status).toBe(400);
    expect((await post(origin, { body: JSON.stringify({ confirm: 'trash-all', ids: ['active'] }) })).status).toBe(400);
    expect(await store.load('active')).toBeDefined();
  });

  it('rejects cross-site bulk requests before any replay is changed', async () => {
    const { store, origin } = await startDataStorage();
    await store.save(replay('active'));
    const response = await post(origin, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } });
    expect(response.status).toBe(403);
    expect(await store.load('active')).toBeDefined();
  });
});

describe('bulk trash storage failures', () => {
  afterEach(closeDataStorageServers);

  it('reports partial storage failures without provider details and bounds concurrent trash writes', async () => {
    const storage = new InterruptedStorage();
    const { store, origin } = await startDataStorage({ storage });
    for (const id of ['gone', 'failed', ...Array.from({ length: 12 }, (_, index) => `replay-${index}`)]) await store.save(replay(id));
    const response = await post(origin);
    expect(response.status).toBe(200);
    expect(await response.clone().text()).not.toContain('private provider diagnostic');
    expect(bulkTrashResultSchema.parse(await response.json())).toEqual({ trashed: 12, protected: 0, unavailable: 1, failed: 1 });
    expect(storage.peak).toBeGreaterThan(1);
    expect(storage.peak).toBeLessThanOrEqual(4);
    expect(await store.load('failed')).toBeDefined();
  });

  it('resolves authorization before mutation so an unexpected host failure does not partially delete the snapshot', async () => {
    const { store, origin } = await startDataStorage({
      authorize: (_, path) => {
        if (path === '/api/replays/broken') throw new TypeError('authorization unavailable');
        return Promise.resolve();
      },
    });
    await store.save(replay('visible'));
    await store.save(replay('broken'));
    const response = await post(origin);
    expect(response.status).toBe(500);
    expect((await store.list()).map((entry) => entry.id)).toEqual(expect.arrayContaining(['visible', 'broken']));
  });
});
