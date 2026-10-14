import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FsStorage,
  globToRegExp,
  MemoryStorage,
  ObjectExistsError,
  type ObjectStorage,
  PreconditionFailedError,
  S3Storage,
  storageFromEnv,
} from '../src/server/storage/index.ts';
import { type S3Emulator, startS3Emulator } from './s3-emulator.ts';

async function text(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

let emulator: S3Emulator | undefined;
beforeAll(async () => {
  emulator = await startS3Emulator();
});
afterAll(async () => {
  await emulator?.stop();
});

const drivers: Array<[string, () => Promise<ObjectStorage | undefined>]> = [
  ['memory', async () => new MemoryStorage()],
  ['fs', async () => new FsStorage(join(await mkdtemp(join(tmpdir(), 'replay-kit-storage-')), 'data'))],
  [
    's3 (in-process emulator)',
    async () => {
      if (!emulator) return undefined;
      return new S3Storage({
        bucket: emulator.bucket(),
        region: emulator.region,
        endpoint: emulator.endpoint,
        forcePathStyle: true,
        prefix: 'replays',
        credentials: emulator.credentials,
      });
    },
  ],
];

describe.each(drivers)('%s storage', (name, make) => {
  const storage = async (skip: (reason: string) => void) => {
    const made = await make();
    if (!made) skip(`${name}: no emulator here`);
    return made!;
  };

  it('writes, stats, reads and versions objects', async ({ skip }) => {
    const store = await storage(skip);
    await expect(store.stat('a/replay.json')).resolves.toBeUndefined();
    await expect(store.read('a/replay.json')).resolves.toBeUndefined();
    const first = await store.write('a/replay.json', '{"v":1}', { contentType: 'application/json' });
    expect(first).toMatchObject({ key: 'a/replay.json', size: 7 });
    expect(first.version).toBeTruthy();
    await expect(store.stat('a/replay.json')).resolves.toMatchObject({ key: 'a/replay.json', size: 7, version: first.version });
    expect((await store.read('a/replay.json'))?.toString()).toBe('{"v":1}');
    // fs versions are mtimes (ms): make the rewrite land in a later millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.write('a/replay.json', '{"v":22}');
    expect(second.version).not.toBe(first.version);
    expect(second.size).toBe(8);
  });

  it('refuses a create-only write over an existing object (409), atomically', async ({ skip }) => {
    const store = await storage(skip);
    await store.write('b/replay.json', 'first', { createOnly: true });
    const racing = await Promise.allSettled([
      store.write('c/replay.json', 'one', { createOnly: true }),
      store.write('c/replay.json', 'two', { createOnly: true }),
    ]);
    expect(racing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(store.write('b/replay.json', 'second', { createOnly: true })).rejects.toBeInstanceOf(ObjectExistsError);
    await expect(store.write('b/replay.json', 'second', { createOnly: true })).rejects.toMatchObject({ status: 409 });
    expect((await store.read('b/replay.json'))?.toString()).toBe('first');
  });

  it('writes over a version only while it is current', async ({ skip }) => {
    const store = await storage(skip);
    const { version } = await store.write('_suites/s.json', '{"runs":[]}');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.write('_suites/s.json', '{"runs":[1]}', { ifVersion: version });
    await expect(store.write('_suites/s.json', '{"runs":[2]}', { ifVersion: version })).rejects.toBeInstanceOf(PreconditionFailedError);
    expect((await store.read('_suites/s.json'))?.toString()).toBe('{"runs":[1]}');
  });

  it('streams whole objects and byte ranges', async ({ skip }) => {
    const store = await storage(skip);
    await store.write('d/preview.mp4', '0123456789abcdef');
    expect(await text(await store.stream('d/preview.mp4'))).toBe('0123456789abcdef');
    expect(await text(await store.stream('d/preview.mp4', { start: 4, end: 7 }))).toBe('4567');
  });

  it('uploads local files', async ({ skip }) => {
    const store = await storage(skip);
    const file = join(await mkdtemp(join(tmpdir(), 'replay-kit-upload-')), 'render.mp4');
    await writeFile(file, Buffer.alloc(3000, 7));
    await expect(store.upload('e/rendered-1x-skip.mp4', file, { contentType: 'video/mp4' })).resolves.toMatchObject({ size: 3000 });
    await expect(store.upload('e/rendered-1x-skip.mp4', file, { createOnly: true })).rejects.toBeInstanceOf(ObjectExistsError);
    expect((await store.read('e/rendered-1x-skip.mp4'))?.byteLength).toBe(3000);
  });

  it('lists by prefix and glob, and deletes objects and prefixes', async ({ skip }) => {
    const store = await storage(skip);
    for (const key of ['f/replay.json', 'f/meta.json', 'f/poster.v2.jpg', 'g/meta.json', 'g/render-1x.json', '_suites/x.json'])
      await store.write(key, 'x');
    const keys = async (options?: Parameters<ObjectStorage['list']>[0]) => (await store.list(options)).map((object) => object.key);
    await expect(keys({ glob: '*/{replay,meta}.json' })).resolves.toEqual(['f/meta.json', 'f/replay.json', 'g/meta.json']);
    await expect(keys({ prefix: 'f/' })).resolves.toEqual(['f/meta.json', 'f/poster.v2.jpg', 'f/replay.json']);
    await expect(keys({ glob: '*/render-*.json' })).resolves.toEqual(['g/render-1x.json']);
    await expect(keys({ prefix: '_suites/', glob: '_suites/*.json' })).resolves.toEqual(['_suites/x.json']);
    await expect(store.delete('g/meta.json')).resolves.toBe(true);
    await expect(store.delete('g/meta.json')).resolves.toBe(false);
    await expect(store.deletePrefix('f/')).resolves.toBeGreaterThanOrEqual(3);
    await expect(keys()).resolves.toEqual(['_suites/x.json', 'g/render-1x.json']);
  });

  it('rejects keys that could escape the root', async ({ skip }) => {
    const store = await storage(skip);
    for (const key of ['../x', '/abs', 'a/../b', 'a//b', 'a/']) await expect(store.write(key, 'x')).rejects.toThrow(/invalid storage key/);
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
