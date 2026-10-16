import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { commentsFromEnv } from '../src/server/comments-config.ts';
import { CommentError, CommentsStore, commentsKey } from '../src/server/comments-store.ts';
import { loadSettings } from '../src/server/config.ts';
import { RateLimiter } from '../src/server/rate-limit.ts';
import { FsStorage, MemoryStorage, type ObjectStorage, S3Storage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { MAX_COMMENT_BODY, MAX_COMMENTS, type CommentsResponse, type PublicComment } from '../src/shared/comments.ts';
import { appDefaults, replay } from './fixtures.ts';
import { type S3Emulator, startS3Emulator } from './s3-emulator.ts';

const DAY = 24 * 60 * 60_000;

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

/** Who is calling: `x-user` is the id, `x-name` and `x-avatar` the display fields (a header-style adapter). */
const signedIn: AuthAdapter = {
  name: 'header',
  authenticate(request: IncomingMessage) {
    const id = request.headers['x-user'];
    if (typeof id !== 'string') return undefined;
    const name = request.headers['x-name'];
    const avatarUrl = request.headers['x-avatar'];
    return { id, ...(typeof name === 'string' ? { name } : {}), ...(typeof avatarUrl === 'string' ? { avatarUrl } : {}) };
  },
};

async function start(options: { enabled?: boolean; auth?: AuthAdapter; storage?: ObjectStorage } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replays-comments-'));
  const store = new ReplayStore(options.storage ?? new MemoryStorage(), join(root, 'sample'), undefined, { listTtlMs: 0 });
  await store.save(replay());
  const handle = createApp({
    ...appDefaults(),
    ...(options.auth ? { auth: options.auth } : {}),
    store,
    clientDir: root,
    ...(options.enabled === false ? {} : { comments: { enabled: true } }),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/api/replays/test-replay/comments`;
  /** A request as `user` (a header-adapter identity). */
  const as = (user: string, extra: Record<string, string> = {}) => {
    const headers = { 'x-user': user, 'content-type': 'application/json', ...extra };
    return {
      get: () => fetch(url, { headers }),
      post: (body: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }),
      patch: (id: string, body: unknown) => fetch(`${url}/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) }),
      delete: (id: string) => fetch(`${url}/${id}`, { method: 'DELETE', headers }),
    };
  };
  return { origin, url, store, as };
}

const listOf = async (response: Response) => ((await response.json()) as CommentsResponse).comments;

describe('comments API', () => {
  it('creates a comment pinned to SOURCE time and lists it with its author, never exposing ids', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com', { 'x-name': 'Ada Lovelace', 'x-avatar': 'https://example.com/ada.png' });
    const created = await ada.post({ body: '  Looks wrong here ', at: 900.4 });
    expect(created.status).toBe(201);
    const comment = (await created.json()) as PublicComment;
    expect(comment).toMatchObject({
      body: 'Looks wrong here',
      at: 900,
      mine: true,
      author: { name: 'Ada Lovelace', avatarUrl: 'https://example.com/ada.png' },
    });
    expect(comment.id).toMatch(/^c-[a-z0-9]{6,20}$/);

    const mine = (await (await ada.get()).json()) as CommentsResponse;
    expect(mine).toMatchObject({
      anonymous: false,
      me: { name: 'Ada Lovelace', anonymous: false },
      comments: [{ id: comment.id, mine: true }],
    });
    const theirs = await as('bob@example.com').get();
    const text = await theirs.text();
    expect(JSON.parse(text).comments[0]).toMatchObject({ mine: false, author: { name: 'Ada Lovelace' } });
    expect(text).not.toContain('ada@example.com');
  });

  it('supports whole-replay comments, validates times against the replay and refuses unknown fields', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com');
    expect((await ada.post({ body: 'About everything' })).status).toBe(201);
    const whole = (await listOf(await ada.get()))[0]!;
    expect(whole.at).toBeUndefined();
    // The replay's span here is 1000 ms.
    expect((await ada.post({ body: 'at the end', at: 1000 })).status).toBe(201);
    for (const bad of [
      { body: 'late', at: 1001 },
      { body: 'neg', at: -1 },
      { body: 'nan', at: 'soon' },
      { body: 'x', admin: true },
      { body: '' },
      {},
    ]) {
      expect((await ada.post(bad)).status).toBe(400);
    }
    const tooLong = await ada.post({ body: 'x'.repeat(MAX_COMMENT_BODY + 1) });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: string }).error).toContain(String(MAX_COMMENT_BODY));
  });

  it('threads replies under a top-level comment only, and resolves or reopens a thread', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com');
    const bob = as('bob@example.com', { 'x-name': 'Bob' });
    const root = (await (await ada.post({ body: 'Is this a bug?', at: 400 })).json()) as PublicComment;
    const reply = await bob.post({ body: 'Yes, filed it', parentId: root.id });
    expect(reply.status).toBe(201);
    const replyBody = (await reply.json()) as PublicComment;
    expect(replyBody).toMatchObject({ parentId: root.id, author: { name: 'Bob' } });
    expect(replyBody.at).toBeUndefined();
    // No replies to replies, to missing comments, and no time of their own.
    expect((await bob.post({ body: 'nested', parentId: replyBody.id })).status).toBe(400);
    expect((await bob.post({ body: 'ghost', parentId: 'c-doesnotexist' })).status).toBe(404);
    expect((await bob.post({ body: 'timed reply', parentId: root.id, at: 100 })).status).toBe(400);

    // Anyone may resolve; the thread says who did.
    const resolved = await bob.patch(root.id, { resolved: true });
    expect(resolved.status).toBe(200);
    expect(((await resolved.json()) as PublicComment).resolved).toMatchObject({ by: 'Bob' });
    expect((await bob.patch(replyBody.id, { resolved: true })).status).toBe(400);
    const reopened = (await (await ada.patch(root.id, { resolved: false })).json()) as PublicComment;
    expect(reopened.resolved).toBeUndefined();
    expect((await ada.patch(root.id, { resolved: true, body: 'both' })).status).toBe(400);
  });

  it('lets only the author edit or delete, and deleting a thread takes its replies', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com');
    const bob = as('bob@example.com');
    const root = (await (await ada.post({ body: 'mine', at: 100 })).json()) as PublicComment;
    const reply = (await (await bob.post({ body: 'bob here', parentId: root.id })).json()) as PublicComment;

    expect((await bob.patch(root.id, { body: 'hijack' })).status).toBe(403);
    expect((await bob.delete(root.id)).status).toBe(403);
    expect((await ada.patch(reply.id, { body: 'hijack' })).status).toBe(403);
    expect((await ada.delete(reply.id)).status).toBe(403);

    const edited = (await (await ada.patch(root.id, { body: 'edited text' })).json()) as PublicComment;
    expect(edited).toMatchObject({ body: 'edited text', mine: true });
    expect(edited.editedAt).toBeTruthy();
    expect((await ada.patch(root.id, { body: '   ' })).status).toBe(400);
    expect((await ada.patch('c-nothere', { body: 'x' })).status).toBe(404);

    // Bob deletes only his reply; Ada deleting the root removes whatever is left of the thread.
    expect(await (await bob.delete(reply.id)).json()).toEqual({ removed: 1 });
    const second = (await (await bob.post({ body: 'again', parentId: root.id })).json()) as PublicComment;
    expect(second.parentId).toBe(root.id);
    expect(await (await ada.delete(root.id)).json()).toEqual({ removed: 2 });
    expect(await listOf(await ada.get())).toEqual([]);
  });

  it('stores reactions pinned at a moment, from a fixed set, with no text', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com');
    const created = await ada.post({ emoji: '🎉', at: 300 });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ emoji: '🎉', at: 300, body: '' });
    expect((await ada.post({ emoji: '💥', at: 300 })).status).toBe(400);
    expect((await ada.post({ emoji: '🎉' })).status).toBe(400);
    expect((await ada.post({ emoji: '🎉', at: 1, body: 'text' })).status).toBe(400);
  });

  it('labels comments "Anonymous" with a flag when auth is none, and says so to the client', async () => {
    const { url, origin } = await start();
    const created = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ author: { name: 'Anonymous', anonymous: true }, mine: true });
    const listed = (await (await fetch(url)).json()) as CommentsResponse;
    expect(listed.anonymous).toBe(true);
    expect(listed.me).toEqual({ name: 'Anonymous', anonymous: true });
    const config = (await (await fetch(`${origin}/api/config`)).json()) as { auth: string; comments: boolean };
    expect(config).toMatchObject({ auth: 'none', comments: true });
  });

  it('rate limits creating and editing per person, with Retry-After, but not reading or resolving', async () => {
    const { as } = await start({ auth: signedIn });
    const ada = as('ada@example.com');
    const bob = as('bob@example.com');
    let first: PublicComment | undefined;
    for (let index = 0; index < 20; index++) {
      const response = await ada.post({ body: `note ${index}` });
      expect(response.status).toBe(201);
      first ??= (await response.json()) as PublicComment;
    }
    const limited = await ada.post({ body: 'one too many' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ retryAfter: expect.any(Number) });
    // Editing counts against the same allowance; reading and resolving do not.
    expect((await ada.patch(first!.id, { body: 'edited' })).status).toBe(429);
    expect((await ada.patch(first!.id, { resolved: true })).status).toBe(200);
    expect((await ada.get()).status).toBe(200);
    // Someone else is unaffected.
    expect((await bob.post({ body: 'hi' })).status).toBe(201);
  });

  it('is a plain 404 with comments off, in the API and in the client config', async () => {
    const { as, origin } = await start({ auth: signedIn, enabled: false });
    const ada = as('ada@example.com');
    expect((await ada.get()).status).toBe(404);
    expect(await (await ada.get()).json()).toEqual({ error: 'not found' });
    expect((await ada.post({ body: 'x' })).status).toBe(404);
    expect((await ada.patch('c-abcdef12', { body: 'x' })).status).toBe(404);
    expect((await ada.delete('c-abcdef12')).status).toBe(404);
    const config = (await (await fetch(`${origin}/api/config`, { headers: { 'x-user': 'ada@example.com' } })).json()) as {
      comments: boolean;
    };
    expect(config.comments).toBe(false);
  });

  it('answers 404 for a missing replay and 405 for other methods', async () => {
    const { origin, as } = await start({ auth: signedIn });
    const missing = await fetch(`${origin}/api/replays/nope/comments`, { headers: { 'x-user': 'ada' } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'replay not found' });
    const put = await fetch(`${origin}/api/replays/test-replay/comments`, { method: 'PUT', headers: { 'x-user': 'ada' } });
    expect(put.status).toBe(405);
    expect((await as('ada').get()).status).toBe(200);
  });

  it('requires an identity and refuses cross-site writes like the rest of the API', async () => {
    const { url, as } = await start({ auth: signedIn });
    expect((await fetch(url)).status).toBe(403);
    const cross = await fetch(url, {
      method: 'POST',
      headers: { 'x-user': 'ada', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(cross.status).toBe(403);
    expect(await listOf(await as('ada').get())).toEqual([]);
  });

  it('drops avatars that are not https image URLs', async () => {
    const { as } = await start({ auth: signedIn });
    const created = await as('ada@example.com', { 'x-avatar': 'javascript:alert(1)' }).post({ body: 'hi' });
    expect(((await created.json()) as PublicComment).author.avatarUrl).toBeUndefined();
  });

  it('redacts credentials in pasted URLs, like uploads do', async () => {
    const { as } = await start({ auth: signedIn });
    const created = await as('ada@example.com').post({ body: 'see https://user:hunter2@example.com/page?token=abc123' });
    const body = ((await created.json()) as PublicComment).body;
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('abc123');
  });
});

const drivers: Array<[string, () => Promise<ObjectStorage | undefined>]> = [
  ['memory', async () => new MemoryStorage()],
  ['fs', async () => new FsStorage(join(await mkdtemp(join(tmpdir(), 'replays-comments-fs-')), 'data'))],
  [
    's3 (in-process emulator)',
    async () =>
      emulator &&
      new S3Storage({
        bucket: emulator.bucket(),
        region: emulator.region,
        endpoint: emulator.endpoint,
        forcePathStyle: true,
        prefix: 'comments',
        credentials: emulator.credentials,
      }),
  ],
];

describe.each(drivers)('comments store on %s', (name, make) => {
  const author = { id: 'ada@example.com', name: 'Ada' };

  it('keeps comments in <id>/comments.json and survives a reopen', async ({ skip }) => {
    const storage = await make();
    if (!storage) skip(`${name}: no emulator here`);
    const store = new CommentsStore(storage!);
    const one = await store.create('rep', { body: 'first', at: 10 }, author, 1000);
    await store.create('rep', { body: 'reply', parentId: one.id }, author, 1000);
    const reopened = new CommentsStore(storage!);
    expect((await reopened.list('rep')).map((comment) => comment.body)).toEqual(['first', 'reply']);
    expect(JSON.parse((await storage!.read(commentsKey('rep')))!.toString())).toMatchObject({ version: 1 });
    expect(await reopened.list('other')).toEqual([]);
  });

  it('never loses a comment when writes race (version-checked, retried)', async ({ skip }) => {
    const storage = await make();
    if (!storage) skip(`${name}: no emulator here`);
    const a = new CommentsStore(storage!);
    const b = new CommentsStore(storage!);
    await a.create('race', { body: 'seed' }, author, 1000);
    await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? a : b).create('race', { body: `note ${index}` }, author, 1000)));
    expect(await a.list('race')).toHaveLength(7);
  });

  it('enforces author-only changes and the per-replay cap', async ({ skip }) => {
    const storage = await make();
    if (!storage) skip(`${name}: no emulator here`);
    const store = new CommentsStore(storage!);
    const created = await store.create('rules', { body: 'mine' }, author, 1000);
    await expect(store.edit('rules', created.id, 'x', 'bob@example.com')).rejects.toMatchObject({ status: 403 });
    await expect(store.remove('rules', created.id, 'bob@example.com')).rejects.toBeInstanceOf(CommentError);
    await expect(store.edit('rules', created.id, 'ok', 'ada@example.com')).resolves.toMatchObject({ body: 'ok' });
    // Fill the replay up to the cap with direct writes, then one more is refused.
    const comments = Array.from({ length: MAX_COMMENTS }, (_, index) => ({
      id: `c-fill${String(index).padStart(5, '0')}`,
      body: 'x',
      author,
      createdAt: '2026-10-14T10:00:00.000Z',
    }));
    await storage!.write(commentsKey('rules'), JSON.stringify({ version: 1, comments }));
    await expect(store.create('rules', { body: 'over' }, author, 1000)).rejects.toMatchObject({ status: 409 });
  });
});

describe('retention', () => {
  it("deletes a replay's comments with it, and keeps them while it is kept", async () => {
    const clock = Date.parse('2026-09-01T00:00:00.000Z');
    const root = await mkdtemp(join(tmpdir(), 'replays-comments-retention-'));
    const storage = new MemoryStorage(() => clock);
    const store = new ReplayStore(storage, join(root, 'sample'), 30);
    await store.save(replay('expiring'));
    await store.save(replay('kept'));
    await store.keep('kept', 'ada@example.com');
    const comments = new CommentsStore(storage);
    await comments.create('expiring', { body: 'gone soon', at: 10 }, { id: 'ada' }, 1000);
    await comments.create('kept', { body: 'stays', at: 10 }, { id: 'ada' }, 1000);
    expect(await storage.stat(commentsKey('expiring'))).toBeDefined();

    expect(await store.prune(clock + 29 * DAY)).toEqual([]);
    expect(await store.prune(clock + 31 * DAY)).toEqual(['expiring']);
    expect(await storage.stat(commentsKey('expiring'))).toBeUndefined();
    expect(await comments.list('expiring')).toEqual([]);
    expect(await comments.list('kept')).toHaveLength(1);
  });

  it('removes the comments file from disk with the replay (filesystem driver)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-comments-fs-retention-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 1);
    await store.save(replay('on-disk'));
    await new CommentsStore(store.storage).create('on-disk', { body: 'note' }, { id: 'ada' }, 1000);
    const file = join(root, 'data', commentsKey('on-disk'));
    await expect(readFile(file, 'utf8')).resolves.toContain('note');
    await store.prune(Date.now() + 2 * DAY);
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('rate limiter', () => {
  it('allows `max` hits per window per key and reports when to retry', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 10_000, () => now);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([0, 0, 0]);
    expect(limiter.hit('a')).toBe(10);
    expect(limiter.hit('b')).toBe(0);
    now = 6000;
    expect(limiter.hit('a')).toBe(4);
    now = 10_001;
    expect(limiter.hit('a')).toBe(0);
  });
});

describe('comments setting', () => {
  it('is on by default, off with REPLAYS_COMMENTS=false or the config file, and the environment wins', async () => {
    expect(commentsFromEnv({})).toEqual({ enabled: true });
    for (const off of ['false', '0', 'no', 'off', ' FALSE '])
      expect(commentsFromEnv({ REPLAYS_COMMENTS: off })).toEqual({ enabled: false });
    expect(commentsFromEnv({ REPLAYS_COMMENTS: 'true' })).toEqual({ enabled: true });
    expect(commentsFromEnv({}, { enabled: false })).toEqual({ enabled: false });
    expect(commentsFromEnv({ REPLAYS_COMMENTS: 'true' }, { enabled: false })).toEqual({ enabled: true });
    expect(commentsFromEnv({ REPLAYS_COMMENTS: 'false' }, { enabled: true })).toEqual({ enabled: false });
    expect(() => commentsFromEnv({ REPLAYS_COMMENTS: 'maybe' })).toThrow('REPLAYS_COMMENTS');
    expect(() => commentsFromEnv({}, { enabled: 'no' })).toThrow('comments.enabled');
    expect((await loadSettings({})).comments).toEqual({ enabled: true });
    expect((await loadSettings({ REPLAYS_COMMENTS: 'false' })).comments).toEqual({ enabled: false });
    expect((await loadSettings({}, { comments: { enabled: false } })).comments).toEqual({ enabled: false });
  });
});
