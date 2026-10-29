import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PosterQueue } from '../src/server/posters.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';
import { ReplayStore } from '../src/server/store.ts';
import { replay } from './fixtures.ts';

const HASH = 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG';
const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'replays-thumbhash-'));
  roots.push(root);
  return root;
}

describe('poster ThumbHash', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('lists an upload with the ThumbHash its poster left', async () => {
    const root = await tempRoot();
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());
    await store.list();
    await store.setThumbHash('test-replay', HASH);
    expect((await store.list())[0]?.thumbhash).toBe(HASH);
    expect((await store.summary('test-replay'))?.thumbhash).toBe(HASH);
  });

  it('keeps the ThumbHash when the summary is rebuilt from the bundle', async () => {
    const root = await tempRoot();
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());
    await store.setThumbHash('test-replay', HASH);
    const meta = join(root, 'data', 'test-replay', 'meta.json');
    const stored: unknown = JSON.parse(await readFile(meta, 'utf8'));
    const stale = Object.assign({}, stored, { summaryVersion: 1, title: 'Stale title' });
    await writeFile(meta, JSON.stringify(stale));
    const rebuilt = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    const [summary] = await rebuilt.list();
    expect(summary?.title).toBe('Test replay');
    expect(summary?.thumbhash).toBe(HASH);
  });

  it('lists a read-only sample with the ThumbHash its poster left, across restarts', async () => {
    const root = await tempRoot();
    const sample = join(root, 'sample');
    await mkdir(sample);
    await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    const store = new ReplayStore(join(root, 'data'), sample);
    expect((await store.list())[0]?.thumbhash).toBeUndefined();
    await mkdir(join(root, 'data', 'sample-replay'), { recursive: true });
    await writeFile(join(root, 'data', `${store.posterKey('sample-replay')}.json`), JSON.stringify({ thumbhash: HASH }));
    await store.setThumbHash('sample-replay', HASH);
    expect((await store.list())[0]?.thumbhash).toBe(HASH);
    const restarted = new ReplayStore(join(root, 'data'), sample);
    expect((await restarted.list())[0]?.thumbhash).toBe(HASH);
  });

  it('ignores a value that is not a ThumbHash', async () => {
    const root = await tempRoot();
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());
    await store.setThumbHash('test-replay', 'url(javascript:alert(1))');
    expect((await store.list())[0]?.thumbhash).toBeUndefined();
  });
});

describe('poster queue ThumbHash', () => {
  it('hands the poster runner’s ThumbHash to the store once the poster is stored', async () => {
    const thumbhash = vi.fn<(id: string, hash: string) => Promise<void>>(() => Promise.resolve());
    const storage = new MemoryStorage();
    const queue = new PosterQueue({
      storage,
      key: (id) => `${id}/poster.jpg`,
      thumbhash,
      runner: async ({ output }) => {
        await writeFile(output, 'image');
        await writeFile(`${output}.json`, JSON.stringify({ thumbhash: HASH }));
      },
    });
    await queue.request('with-hash');
    await queue.settled('with-hash');
    expect(await storage.stat('with-hash/poster.jpg')).toBeTruthy();
    expect(thumbhash).toHaveBeenCalledWith('with-hash', HASH);
  });

  it('stores a poster without a ThumbHash and leaves the summary alone', async () => {
    const thumbhash = vi.fn<(id: string, hash: string) => Promise<void>>(() => Promise.resolve());
    const queue = new PosterQueue({
      storage: new MemoryStorage(),
      key: (id) => `${id}/poster.jpg`,
      thumbhash,
      runner: async ({ output }) => {
        await writeFile(output, 'image');
      },
    });
    await queue.request('plain');
    await queue.settled('plain');
    expect(await queue.request('plain')).toBe('ready');
    expect(thumbhash).not.toHaveBeenCalled();
  });
});
