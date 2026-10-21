import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReplayStore } from '../src/server/store.ts';
import { FsStorage, globToRegExp, MemoryStorage, S3Storage, storageFromEnv } from '../src/server/storage/index.ts';
import { describeObjectStorage } from '../src/server/testing/index.ts';
import { type S3Emulator, startS3Emulator } from './s3-emulator.ts';

let emulator: S3Emulator | undefined;
beforeAll(async () => {
  emulator = await startS3Emulator();
});
afterAll(async () => {
  await emulator?.stop();
});

// The same suite a third-party backend runs (`@hazem3500/replays/server/testing`).
describeObjectStorage('memory', () => new MemoryStorage(), { describe, it });
describeObjectStorage('fs', async () => new FsStorage(join(await mkdtemp(join(tmpdir(), 'replays-storage-')), 'data')), { describe, it });
describeObjectStorage(
  's3 (in-process emulator)',
  () =>
    emulator &&
    new S3Storage({
      bucket: emulator.bucket(),
      region: emulator.region,
      endpoint: emulator.endpoint,
      forcePathStyle: true,
      prefix: 'replays',
      credentials: emulator.credentials,
    }),
  { describe, it },
);

describe("the store's list cache", () => {
  it("follows the backend's listCacheMs: s3 5 s, fs and memory none, a plugin backend its own", () => {
    const samples = join(tmpdir(), 'replays-no-samples');
    expect(new ReplayStore(new MemoryStorage(), samples).listTtlMs).toBe(0);
    const s3 = new S3Storage({ bucket: 'b', region: 'us-east-1', credentials: { accessKeyId: 'a', secretAccessKey: 's' } });
    expect(new ReplayStore(s3, samples).listTtlMs).toBe(5000);
    const custom = Object.assign(new MemoryStorage(), { kind: 'acme', listCacheMs: 1234 });
    expect(new ReplayStore(custom, samples).listTtlMs).toBe(1234);
    expect(new ReplayStore(custom, samples, undefined, { listTtlMs: 0 }).listTtlMs).toBe(0);
  });
});

describe('storage selection', () => {
  const credentials = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' };

  it('defaults to the fs driver on DATA_DIR and configures s3 from the environment', async () => {
    await expect(storageFromEnv({}, '/tmp/x')).resolves.toMatchObject({ kind: 'fs', root: '/tmp/x' });
    await expect(storageFromEnv({ STORAGE: 's3' }, '/tmp/x')).rejects.toThrow(/S3_BUCKET/);
    await expect(storageFromEnv({ STORAGE: 's3', S3_BUCKET: 'b' }, '/tmp/x')).rejects.toThrow(/AWS_ACCESS_KEY_ID/);
    await expect(storageFromEnv({ STORAGE: 'nope' }, '/tmp/x')).rejects.toThrow(/fs or s3/);
    await expect(
      storageFromEnv(
        { STORAGE: 's3', S3_BUCKET: 'b', S3_PREFIX: 'replays', S3_ENDPOINT: 'http://localhost:9000', ...credentials },
        '/tmp/x',
      ),
    ).resolves.toMatchObject({ kind: 's3', description: 's3://b/replays/' });
    const storage = await storageFromEnv({ STORAGE: 's3', S3_BUCKET: 'b', ...credentials }, '/tmp/x');
    expect(JSON.stringify(storage.description)).not.toContain('secret');
  });

  it('matches the glob subset it uses', () => {
    expect(globToRegExp('*/{replay,meta}.json').test('a/meta.json')).toBe(true);
    expect(globToRegExp('*/{replay,meta}.json').test('a/b/meta.json')).toBe(false);
    expect(globToRegExp('*/{replay,meta}.json').test('a/poster.jpg')).toBe(false);
    expect(globToRegExp('**/x.json').test('a/b/x.json')).toBe(true);
    expect(globToRegExp('**/x.json').test('x.json')).toBe(true);
  });
});
