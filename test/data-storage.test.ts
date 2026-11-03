import type { IncomingMessage } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { dataStorageSchema } from '../src/shared/data-storage.ts';
import { HttpError } from '../src/shared/http-error.ts';
import { replay } from './fixtures.ts';
import { startDataStorage as start, closeDataStorageServers } from './data-storage-fixture.ts';

describe('data and storage API', () => {
  afterEach(closeDataStorageServers);
  it('reports effective policy and permits restoration through the existing authorized replay endpoint', async () => {
    const { store, origin } = await start();
    await store.save(replay('deleted'));
    await store.trash('deleted', 'ada');
    const response = await fetch(`${origin}/api/data-storage`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const info = dataStorageSchema.parse(await response.json());
    expect(info).toMatchObject({
      backend: 'memory',
      retention: { days: 45, profiles: { triage: 7 }, expiredDays: 12, trashDays: 7, hasRules: false },
      trash: [{ id: 'deleted' }],
    });
    expect(JSON.stringify(info)).not.toContain('ada');
    const restored = await fetch(`${origin}/api/replays/deleted/restore`, { method: 'POST', headers: { origin } });
    expect(restored.status).toBe(200);
    const after = dataStorageSchema.parse(await (await fetch(`${origin}/api/data-storage`)).json());
    expect(after.trash).toEqual([]);
  });

  it('omits denied replay IDs and authorizes derived read requests without changing the original request', async () => {
    const requests: Array<{ request: IncomingMessage; path: string }> = [];
    const { store, origin } = await start({
      authorize: (request, path) => {
        requests.push({ request, path });
        if (path === '/api/replays/hidden') throw new HttpError(403, 'private replay');
        return Promise.resolve();
      },
    });
    for (const id of ['visible', 'hidden']) {
      await store.save(replay(id));
      await store.trash(id, 'ada');
    }
    const response = await fetch(`${origin}/api/data-storage`);
    const info = dataStorageSchema.parse(await response.json());
    expect(info.trash.map((entry) => entry.id)).toEqual(['visible']);
    const original = requests.find((entry) => entry.path === '/api/data-storage')?.request;
    const derived = requests.find((entry) => entry.path === '/api/replays/visible')?.request;
    expect(original?.url).toBe('/api/data-storage');
    expect(derived?.url).toBe('/api/replays/visible');
    expect(derived).not.toBe(original);
  });

  it('blocks the read route when authentication does not identify the caller', async () => {
    const { origin } = await start({ auth: { name: 'test', authenticate: (): undefined => {} } });
    const response = await fetch(`${origin}/api/data-storage`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('backend');
  });

  it('does not disclose trash to a caller whose endpoint grant only permits reading storage policy', async () => {
    const { store, origin } = await start({
      auth: {
        name: 'scoped',
        authenticate: () => ({ id: 'narrow', capabilities: { routes: [{ method: 'GET', path: '/api/data-storage' }] } }),
      },
    });
    await store.save(replay('hidden'));
    await store.trash('hidden', 'ada');
    const response = await fetch(`${origin}/api/data-storage`);
    expect(response.status).toBe(200);
    expect(dataStorageSchema.parse(await response.json()).trash).toEqual([]);
  });
});

describe('storage authorization failures', () => {
  afterEach(closeDataStorageServers);

  it('preserves keep protection when deletion is requested through storage management', async () => {
    const { store, origin } = await start();
    await store.save(replay('kept'));
    await store.keep('kept', 'ada');
    const response = await fetch(`${origin}/api/replays/kept`, { method: 'DELETE', headers: { origin } });
    expect(response.status).toBe(409);
    expect((await store.list()).map((summary) => summary.id)).toContain('kept');
    expect(dataStorageSchema.parse(await (await fetch(`${origin}/api/data-storage`)).json()).trash).toEqual([]);
  });

  it('fails the request instead of treating an unexpected authorization error as permission to disclose trash', async () => {
    const { store, origin } = await start({
      authorize: (_, path) => {
        if (path === '/api/replays/hidden') throw new TypeError('authorization service unavailable');
        return Promise.resolve();
      },
    });
    await store.save(replay('hidden'));
    await store.trash('hidden', 'ada');
    const response = await fetch(`${origin}/api/data-storage`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hidden');
  });
});
