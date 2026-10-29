import { createServer } from 'node:http';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { RetentionPolicy } from '../src/shared/retention.ts';
import { appDefaults, replay } from './fixtures.ts';

const DAY = 86_400_000;
const roots: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

async function storeWith(retention: Partial<RetentionPolicy>) {
  const root = await mkdtemp(join(tmpdir(), 'replays-expired-'));
  roots.push(root);
  return { root, store: new ReplayStore(join(root, 'data'), join(root, 'sample'), retention) };
}

/** Saves a replay whose upload is `ageDays` old (age counts from the stored file's time). */
async function uploadAged({ root, store }: { root: string; store: ReplayStore }, id: string, ageDays: number, profile?: string) {
  const bundle = replay(id);
  bundle.meta.title = `Checkout ${id}`;
  if (profile) bundle.meta.profile = profile;
  await store.save(bundle);
  const when = new Date(Date.now() - ageDays * DAY);
  await utimes(join(root, 'data', id, 'replay.json'), when, when);
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('expired replays', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('keeps a record of what retention removed and why, without the recording', async () => {
    const { root, store } = await storeWith({ days: 7 });
    await uploadAged({ root, store }, 'old-replay', 10);
    await uploadAged({ root, store }, 'fresh-replay', 1);
    await expect(store.prune()).resolves.toEqual(['old-replay']);
    const { days, records: replays } = await store.expiredReplays();
    expect(days).toBe(30);
    expect(replays).toHaveLength(1);
    expect(replays[0]).toMatchObject({ id: 'old-replay', title: 'Checkout old-replay', host: 'example.com', retentionDays: 7 });
    expect(Object.keys(replays[0] ?? {})).not.toContain('url');
    await expect(store.load('old-replay')).resolves.toBeUndefined();
  });

  it('names the profile whose window removed it', async () => {
    const { root, store } = await storeWith({ days: 30, profiles: { triage: 5 } });
    await uploadAged({ root, store }, 'triaged', 6, 'triage');
    await store.prune();
    expect((await store.expiredReplays()).records[0]).toMatchObject({ id: 'triaged', profile: 'triage', retentionDays: 5 });
  });

  it('drops a record once it is older than the expired window', async () => {
    const { root, store } = await storeWith({ days: 7, expiredDays: 3 });
    await uploadAged({ root, store }, 'old-replay', 10);
    await store.prune();
    expect((await store.expiredReplays()).records).toHaveLength(1);
    await store.prune(Date.now() + 4 * DAY);
    expect((await store.expiredReplays()).records).toEqual([]);
  });

  it('keeps no records when the expired window is 0', async () => {
    const { root, store } = await storeWith({ days: 7, expiredDays: 0 });
    await uploadAged({ root, store }, 'old-replay', 10);
    await store.prune();
    expect(await store.expiredReplays()).toEqual({ days: 0, records: [] });
  });

  it('forgets the record when a replay is uploaded again under the same id', async () => {
    const { root, store } = await storeWith({ days: 7 });
    await uploadAged({ root, store }, 'again', 10);
    await store.prune();
    await store.save(replay('again'));
    expect((await store.expiredReplays()).records).toEqual([]);
  });

  it('serves the records at GET /api/expired-replays', async () => {
    const { root, store } = await storeWith({ days: 7 });
    await uploadAged({ root, store }, 'old-replay', 10);
    await store.prune();
    const handle = createApp({ ...appDefaults(), store, clientDir: join(root, 'client') });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/expired-replays`);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ days: 30, records: [{ id: 'old-replay', retentionDays: 7 }] });
  });
});
