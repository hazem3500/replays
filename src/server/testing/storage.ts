import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { ObjectExistsError, type ObjectStorage, PreconditionFailedError } from '../storage/types.ts';
import { runnerOf, type TestRunner } from './runner.ts';

/**
 * Makes the storage under test. Called once per test; it must return an **empty** store each time (a fresh directory, bucket
 * or key prefix). Return undefined to skip the test (no emulator here).
 */
export type ObjectStorageFactory = () => ObjectStorage | undefined | Promise<ObjectStorage | undefined>;

async function text(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

const status = (expected: number) => (error: unknown) => (error as { status?: unknown }).status === expected;

/** Waits past the current millisecond: fs versions are mtimes (ms), so a rewrite must land in a later one. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const cases: Array<[string, (store: ObjectStorage) => Promise<void>]> = [
  [
    'describes itself',
    async (store) => {
      assert.equal(typeof store.kind, 'string');
      assert.ok(store.kind.length > 0, 'kind is a non-empty string');
      assert.equal(typeof store.description, 'string');
      if (store.listCacheMs !== undefined) assert.ok(Number.isFinite(store.listCacheMs) && store.listCacheMs >= 0, 'listCacheMs is ms ≥ 0');
    },
  ],
  [
    'writes, stats, reads and versions objects',
    async (store) => {
      assert.equal(await store.stat('a/replay.json'), undefined);
      assert.equal(await store.read('a/replay.json'), undefined);
      const first = await store.write('a/replay.json', '{"v":1}', { contentType: 'application/json' });
      assert.equal(first.key, 'a/replay.json');
      assert.equal(first.size, 7);
      assert.ok(first.version, 'a write returns a version');
      assert.ok(first.updatedMs > 0 && first.createdMs > 0, 'a write returns its times');
      const stat = await store.stat('a/replay.json');
      assert.equal(stat?.key, 'a/replay.json');
      assert.equal(stat?.size, 7);
      assert.equal(stat?.version, first.version);
      assert.equal((await store.read('a/replay.json'))?.toString(), '{"v":1}');
      await tick();
      const second = await store.write('a/replay.json', Buffer.from('{"v":22}'));
      assert.notEqual(second.version, first.version);
      assert.equal(second.size, 8);
      assert.equal((await store.stat('a/replay.json'))?.version, second.version);
    },
  ],
  [
    'refuses a create-only write over an existing object (409), atomically',
    async (store) => {
      await store.write('b/replay.json', 'first', { createOnly: true });
      const racing = await Promise.allSettled([
        store.write('c/replay.json', 'one', { createOnly: true }),
        store.write('c/replay.json', 'two', { createOnly: true }),
      ]);
      assert.equal(racing.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one racing create wins');
      await assert.rejects(store.write('b/replay.json', 'second', { createOnly: true }), ObjectExistsError);
      await assert.rejects(store.write('b/replay.json', 'second', { createOnly: true }), status(409));
      assert.equal((await store.read('b/replay.json'))?.toString(), 'first');
    },
  ],
  [
    'writes over a version only while it is current',
    async (store) => {
      const { version } = await store.write('_suites/s.json', '{"runs":[]}');
      await tick();
      await store.write('_suites/s.json', '{"runs":[1]}', { ifVersion: version });
      await assert.rejects(store.write('_suites/s.json', '{"runs":[2]}', { ifVersion: version }), PreconditionFailedError);
      await assert.rejects(store.write('_suites/s.json', '{"runs":[2]}', { ifVersion: version }), status(409));
      assert.equal((await store.read('_suites/s.json'))?.toString(), '{"runs":[1]}');
    },
  ],
  [
    'streams whole objects and byte ranges',
    async (store) => {
      await store.write('d/preview.mp4', '0123456789abcdef');
      assert.equal(await text(await store.stream('d/preview.mp4')), '0123456789abcdef');
      assert.equal(await text(await store.stream('d/preview.mp4', { start: 4, end: 7 })), '4567');
      assert.equal(await text(await store.stream('d/preview.mp4', { start: 15, end: 15 })), 'f');
      await assert.rejects(store.stream('d/missing.mp4'), status(404));
    },
  ],
  [
    'uploads local files',
    async (store) => {
      const dir = await mkdtemp(join(tmpdir(), 'replays-contract-'));
      try {
        const file = join(dir, 'render.mp4');
        await writeFile(file, Buffer.alloc(3000, 7));
        const info = await store.upload('e/rendered-1x-skip.mp4', file, { contentType: 'video/mp4' });
        assert.equal(info.size, 3000);
        assert.ok(info.version);
        await assert.rejects(store.upload('e/rendered-1x-skip.mp4', file, { createOnly: true }), ObjectExistsError);
        assert.equal((await store.read('e/rendered-1x-skip.mp4'))?.byteLength, 3000);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  ],
  [
    'lists by prefix and glob, and deletes objects and prefixes',
    async (store) => {
      for (const key of ['f/replay.json', 'f/meta.json', 'f/poster.v2.jpg', 'g/meta.json', 'g/render-1x.json', '_suites/x.json'])
        await store.write(key, 'x');
      const keys = async (options?: Parameters<ObjectStorage['list']>[0]) => (await store.list(options)).map((object) => object.key);
      assert.deepEqual(await keys({ glob: '*/{replay,meta}.json' }), ['f/meta.json', 'f/replay.json', 'g/meta.json']);
      assert.deepEqual(await keys({ prefix: 'f/' }), ['f/meta.json', 'f/poster.v2.jpg', 'f/replay.json']);
      assert.deepEqual(await keys({ glob: '*/render-*.json' }), ['g/render-1x.json']);
      assert.deepEqual(await keys({ prefix: '_suites/', glob: '_suites/*.json' }), ['_suites/x.json']);
      const listed = (await store.list({ prefix: 'g/' })).find((object) => object.key === 'g/meta.json');
      assert.equal(listed?.size, 1);
      assert.equal(listed?.version, (await store.stat('g/meta.json'))?.version, 'a listing carries the same version as stat');
      assert.equal(await store.delete('g/meta.json'), true);
      assert.equal(await store.delete('g/meta.json'), false);
      assert.ok((await store.deletePrefix('f/')) >= 3);
      assert.deepEqual(await keys(), ['_suites/x.json', 'g/render-1x.json']);
    },
  ],
  [
    'rejects keys that could escape the root',
    async (store) => {
      for (const key of ['../x', '/abs', 'a/../b', 'a//b', 'a/', ''])
        await assert.rejects(store.write(key, 'x'), /invalid storage key/, `refuses ${JSON.stringify(key)}`);
      await assert.rejects(
        Promise.resolve().then(() => store.read('../x')),
        /invalid storage key/,
      );
    },
  ],
];

/**
 * The contract every `ObjectStorage` passes, as a test suite: the built-in `fs`, `s3` and `memory` drivers run it, and so
 * can yours. Assertions use `node:assert`, so it runs under any runner: pass its `describe` and `it`.
 *
 *   import { describe, it } from 'vitest';            // or 'node:test'
 *   import { describeObjectStorage } from '@hazem3500/replays/server/testing';
 *   describeObjectStorage('acme', () => new AcmeStorage({ bucket: freshBucket() }), { describe, it });
 *
 * Covers versions, create-only and compare-and-swap writes (`ObjectExistsError`, `PreconditionFailedError`, both 409), ranged
 * streams, uploads, prefix and glob listing (sorted by key), deletes and key validation (`assertKey`).
 */
export function describeObjectStorage(name: string, factory: ObjectStorageFactory, runner?: TestRunner) {
  const { describe, it } = runnerOf(runner, 'describeObjectStorage');
  describe(`${name} storage (ObjectStorage contract)`, () => {
    for (const [title, run] of cases)
      it(title, async (context) => {
        const store = await factory();
        if (!store) {
          context?.skip?.(`${name}: no backend available here`);
          return;
        }
        await run(store);
      });
  });
}
