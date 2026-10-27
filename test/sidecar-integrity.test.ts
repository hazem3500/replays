import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { commentsKey, CommentsStore } from '../src/server/comments-store.ts';
import { MemoryStorage, readJson } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const id = 'test-replay';
const edits = { version: 1, cuts: [{ id: 'cut', from: 100, to: 300 }] };

async function fixture() {
  const storage = new MemoryStorage();
  const store = new ReplayStore(storage, '/nonexistent-samples');
  await store.save(replay());
  return { storage, store, comments: new CommentsStore(storage) };
}

const add = (comments: CommentsStore) => comments.create(id, { body: 'new comment' }, { id: 'author' }, 1000);

describe('sidecar integrity', () => {
  it('only treats missing JSON as absent', async () => {
    const storage = new MemoryStorage();
    await expect(readJson(storage, 'missing.json')).resolves.toBeUndefined();
    await storage.write('corrupt.json', '{');
    await expect(readJson(storage, 'corrupt.json')).rejects.toMatchObject({ status: 503 });
    vi.spyOn(storage, 'read').mockRejectedValueOnce(new Error('secret provider detail'));
    await expect(readJson(storage, 'corrupt.json')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('retry') });
  });

  it('creates missing sidecars and preserves valid existing comments and edits', async () => {
    const { storage, store, comments } = await fixture();
    await expect(comments.list(id)).resolves.toEqual([]);
    const first = await add(comments);
    await add(comments);
    expect(await comments.list(id)).toHaveLength(2);
    expect((await comments.list(id))[0]).toEqual(first);
    await expect(store.readEdits(id)).resolves.toMatchObject({ edits: { revision: 0 }, version: undefined });
    const saved = await store.saveEdits(id, edits, { by: 'author', ifVersion: null });
    await expect(store.readEdits(id)).resolves.toMatchObject({ edits: { revision: 1 }, version: saved.version });
    expect(await storage.read(commentsKey(id))).toBeDefined();
  });

  it.each([
    ['unparsable', '{', 503],
    ['invalid envelope', 'null', 503],
    ['invalid element', JSON.stringify({ version: 1, comments: [null] }), 503],
    [
      'invalid author',
      JSON.stringify({ version: 1, comments: [{ id: 'c-123456', body: 'saved', author: {}, createdAt: '2026-10-27T00:00:00Z' }] }),
      503,
    ],
    ['newer format', JSON.stringify({ version: 2, comments: [] }), 409],
    ['older format', JSON.stringify({ version: 0, comments: [] }), 409],
  ])('never overwrites %s comments', async (_name, bytes, status) => {
    const { storage, comments } = await fixture();
    const key = commentsKey(id);
    const before = await storage.write(key, bytes);
    await expect(add(comments)).rejects.toMatchObject({ status });
    await expect(comments.list(id)).rejects.toMatchObject({ status });
    expect((await storage.read(key))?.toString()).toBe(bytes);
    expect((await storage.stat(key))?.version).toBe(before.version);
  });

  it.each([
    ['unparsable', '{', 503],
    ['invalid envelope', 'null', 503],
    ['invalid element', JSON.stringify({ version: 1, revision: 1, cuts: [null] }), 503],
    ['newer format', JSON.stringify({ version: 2, revision: 1, cuts: [] }), 409],
    ['older format', JSON.stringify({ version: 0, revision: 1, cuts: [] }), 409],
  ])('never overwrites %s edits', async (_name, bytes, status) => {
    const { storage, store } = await fixture();
    const key = store.editsKey(id);
    const before = await storage.write(key, bytes);
    await expect(store.saveEdits(id, edits, { by: 'author', ifVersion: before.version })).rejects.toMatchObject({ status });
    expect((await storage.read(key))?.toString()).toBe(bytes);
    expect((await storage.stat(key))?.version).toBe(before.version);
  });

  it.each(['comments', 'edits'] as const)('never overwrites %s after read or stat errors, or a disappearance after stat', async (kind) => {
    const { storage, store, comments } = await fixture();
    const key = kind === 'comments' ? commentsKey(id) : store.editsKey(id);
    if (kind === 'comments') await add(comments);
    else await store.saveEdits(id, edits, { by: 'author', ifVersion: null });
    const before = await storage.read(key);
    const info = (await storage.stat(key))!;
    await store.replaySpan(id);
    const save = () =>
      kind === 'comments' ? add(comments) : store.saveEdits(id, { version: 1, cuts: [] }, { by: 'author', ifVersion: info.version });
    const read = storage.read.bind(storage);
    const stat = storage.stat.bind(storage);
    for (const failure of ['read', 'stat', 'missing'] as const) {
      if (failure === 'stat')
        vi.spyOn(storage, 'stat').mockImplementation(async (path) => {
          if (path === key) throw new Error('provider unavailable');
          return stat(path);
        });
      else
        vi.spyOn(storage, 'read').mockImplementation(async (path) => {
          if (path !== key) return read(path);
          if (failure === 'missing') return undefined;
          throw new Error('provider unavailable');
        });
      await expect(save()).rejects.toMatchObject({ status: 503 });
      vi.restoreAllMocks();
      expect(await storage.read(key)).toEqual(before);
      expect((await storage.stat(key))?.version).toBe(info.version);
    }
  });

  it('returns actionable storage errors over HTTP without provider details', async () => {
    const { storage, store } = await fixture();
    await storage.write(store.editsKey(id), '{');
    const app = createApp({ ...appDefaults(), store, clientDir: '/nonexistent-client', beta: { editor: true, malleable: false } });
    const server = createServer((request, response) => void app(request, response));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/replays/${id}/edits`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: expect.stringContaining('restore') });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
