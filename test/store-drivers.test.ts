import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { FsStorage, MemoryStorage, type ObjectStorage, S3Storage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';
import { type S3Emulator, startS3Emulator } from './s3-emulator.ts';

let emulator: S3Emulator | undefined;
beforeAll(async () => {
  emulator = await startS3Emulator();
});
afterAll(async () => {
  await emulator?.stop();
});

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Counts reads, so a test can tell the list parsed only what changed. */
function counting(storage: ObjectStorage) {
  const reads: string[] = [];
  const read = storage.read.bind(storage);
  storage.read = async (key: string) => {
    reads.push(key);
    return read(key);
  };
  return reads;
}

const drivers: Array<[string, () => Promise<ObjectStorage | undefined>]> = [
  ['memory', async () => new MemoryStorage()],
  ['fs', async () => new FsStorage(join(await mkdtemp(join(tmpdir(), 'replay-kit-drivers-')), 'data'))],
  [
    's3 (in-process emulator)',
    async () => {
      if (!emulator) return undefined;
      return new S3Storage({
        bucket: emulator.bucket(),
        region: emulator.region,
        endpoint: emulator.endpoint,
        forcePathStyle: true,
        prefix: 'lab',
        credentials: emulator.credentials,
      });
    },
  ],
];

describe.each(drivers)('ReplayStore on %s', (name, make) => {
  const open = async (skip: (reason: string) => void) => {
    const storage = await make();
    if (!storage) skip(`${name}: no emulator here`);
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-drivers-'));
    return new ReplayStore(storage!, join(root, 'sample'), undefined, { listTtlMs: 0 });
  };

  it('saves once per id (409 after), loads, and stores a video once', async ({ skip }) => {
    const store = await open(skip);
    await store.save(replay('one'));
    await expect(store.save(replay('one'))).rejects.toMatchObject({ status: 409 });
    await expect(store.load('one')).resolves.toEqual(replay('one'));
    await expect(store.saveVideo('missing', Buffer.from('v'))).rejects.toMatchObject({ status: 404 });
    await store.saveVideo('one', Buffer.from('video'));
    await expect(store.saveVideo('one', Buffer.from('again'))).rejects.toMatchObject({ status: 409 });
    expect((await store.storage.read(store.videoKey('one')))?.toString()).toBe('video');
  });

  it('lists from sidecars, parsing each once per version, and backfills a missing one', async ({ skip }) => {
    const store = await open(skip);
    await store.save(replay('a'));
    await store.save(replay('b'));
    const reads = counting(store.storage);
    await expect(store.list()).resolves.toHaveLength(2);
    reads.length = 0;
    await store.list();
    expect(reads.filter((key) => key.endsWith('meta.json') || key.endsWith('replay.json'))).toEqual([]);
    await store.storage.delete(store.metaKey('b'));
    await expect(store.list()).resolves.toMatchObject(expect.arrayContaining([expect.objectContaining({ id: 'b', steps: 1 })]));
    await expect(store.storage.stat(store.metaKey('b'))).resolves.toBeTruthy();
  });

  it('reuses a list for its TTL, and forgets it after its own writes', async ({ skip }) => {
    const base = await open(skip);
    const store = new ReplayStore(base.storage, base.sampleDir, undefined, { listTtlMs: 60_000 });
    await store.save(replay('first'));
    await expect(store.list()).resolves.toHaveLength(1);
    // Another replica's upload shows up when the TTL runs out; this process's own at once.
    await new ReplayStore(base.storage, base.sampleDir).save(replay('elsewhere'));
    await expect(store.list()).resolves.toHaveLength(1);
    await store.save(replay('second'));
    await expect(store.list()).resolves.toHaveLength(3);
  });

  it('keeps every concurrent run registration, across two replicas too', async ({ skip }) => {
    const store = await open(skip);
    // A second process on the same bucket: its own in-process lock, so only write preconditions protect runs.
    // DATA_DIR is one process's volume (fs compares versions without a cross-process lock): one store there.
    const replica = store.storage.kind === 'fs' ? store : new ReplayStore(store.storage, store.sampleDir);
    await store.registerSuite('suite', {
      version: 1,
      id: 'suite',
      title: 'Review',
      createdAt: '2026-10-12T00:00:00.000Z',
      subject: { provider: 'github', url: 'https://github.com/example-org/shop-demo/issues/1' },
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? replica : store).registerRun('suite', `run-${index}`, {
          id: `run-${index}`,
          sequence: index + 1,
          label: `Run ${index}`,
          status: 'running',
          startedAt: '2026-10-12T00:00:00.000Z',
        }),
      ),
    );
    expect((await store.loadSuite('suite'))?.runs).toHaveLength(6);
  });

  it('serves bundles (ETag, 304, br) and media (ranges) through the server', async ({ skip }) => {
    const store = await open(skip);
    const bundle = replay('served');
    bundle.console.push(...Array.from({ length: 50 }, (_, at) => ({ at, level: 'log' as const, message: `line ${at} `.repeat(10) })));
    await store.save(bundle);
    await store.saveVideo('served', Buffer.from('0123456789'));
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: tmpdir(),
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const api = `http://127.0.0.1:${address.port}/api/replays`;

    const first = await fetch(`${api}/served`, { headers: { 'accept-encoding': 'br' } });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-encoding')).toBe('br');
    expect(first.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(await first.json()).toEqual(bundle);
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^W\/"/);
    expect((await fetch(`${api}/served`, { headers: { 'if-none-match': etag } })).status).toBe(304);
    const plain = await fetch(`${api}/served`, { headers: { 'accept-encoding': 'identity' } });
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.json()).toEqual(bundle);

    const video = await fetch(`${api}/served/video`);
    expect(video.headers.get('content-disposition')).toBe('attachment; filename="served.mp4"');
    expect(await video.text()).toBe('0123456789');
    expect((await fetch(`${api}/missing/video`)).status).toBe(404);
  });
});
