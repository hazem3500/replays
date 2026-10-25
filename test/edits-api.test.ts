import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { editsEtag, versionFromEtag } from '../src/server/edits-routes.ts';
import { parseStateFile, RenderQueue, renderVariant } from '../src/server/render-queue.ts';
import type { RenderService } from '../src/server/render-routes.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { editsVersion, type ReplayEdits } from '../src/shared/edits.ts';
import { renderFilename, renderQuery } from '../src/shared/render-variant.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const cut = (from: number, to: number, id = 'c1'): ReplayEdits => ({ version: 1, cuts: [{ id, from, to }] });

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), 'replays-edits-'));
  const sample = join(root, 'sample');
  await mkdir(sample);
  await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
  const store = new ReplayStore(join(root, 'data'), sample, 7);
  await store.save(replay());
  return { root, store };
}

describe('ReplayStore edits', () => {
  it('reads no edits as an empty list at revision 0', async () => {
    const { store } = await tempStore();
    await expect(store.readEdits('test-replay')).resolves.toEqual({ edits: { version: 1, cuts: [], revision: 0 }, version: undefined });
  });

  it('saves with authorship and bumps the revision, generation-checked', async () => {
    const { store } = await tempStore();
    const now = new Date('2026-10-14T10:00:00.000Z');
    const first = await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null, now });
    expect(first).toMatchObject({ changed: true, edits: { revision: 1, updatedBy: 'ada@example.com', updatedAt: now.toISOString() } });
    // A save over an older version (here: "none") is a conflict that carries the current list.
    await expect(store.saveEdits('test-replay', cut(100, 400), { by: 'bob@example.com', ifVersion: null })).rejects.toMatchObject({
      status: 409,
      current: { revision: 1, cuts: [{ id: 'c1', from: 100, to: 300 }] },
    });
    const second = await store.saveEdits('test-replay', cut(100, 400), { by: 'bob@example.com', ifVersion: first.version! });
    expect(second.edits).toMatchObject({ revision: 2, updatedBy: 'bob@example.com' });
    await expect(store.readEdits('test-replay')).resolves.toMatchObject({ edits: { revision: 2 }, version: second.version });
  });

  it('treats saving the stored list again as an idempotent no-op, whatever version it names', async () => {
    const { store } = await tempStore();
    const first = await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    // A retry of the same save (its first attempt landed, the answer was lost) names the old version.
    const retry = await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    expect(retry).toMatchObject({ changed: false, edits: { revision: 1 }, version: first.version });
  });

  it('stores effects (zoom, speed, blur, captions) with the list, and refuses a blur box outside the frame', async () => {
    const { store } = await tempStore();
    const effects: ReplayEdits = {
      version: 1,
      cuts: [],
      zooms: [{ id: 'zoom-1', from: 100, to: 900, scale: 1.8 }],
      speeds: [{ id: 'speed-1', from: 500, to: 800, rate: 4 }],
      blurs: [{ id: 'blur-1', from: 0, to: 900, x: 0.1, y: 0.1, width: 0.4, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 0, to: 500, text: 'Sign in' }],
    };
    const saved = await store.saveEdits('test-replay', effects, { by: 'ada@example.com', ifVersion: null });
    expect(saved.edits).toMatchObject({ ...effects, revision: 1 });
    const outside = { ...effects, blurs: [{ id: 'blur-1', from: 0, to: 900, x: 0.9, y: 0.1, width: 0.4, height: 0.2 }] };
    await expect(store.saveEdits('test-replay', outside, { by: 'ada@example.com', ifVersion: saved.version! })).rejects.toThrow(
      'inside the frame',
    );
  });

  it('validates against the replay span and refuses unknown replays', async () => {
    const { store } = await tempStore();
    await expect(store.saveEdits('test-replay', cut(100, 5000), { by: 'ada@example.com', ifVersion: null })).rejects.toThrow(
      'after the end of the replay',
    );
    await expect(store.saveEdits('nope', cut(100, 300), { by: 'ada@example.com', ifVersion: null })).rejects.toMatchObject({ status: 404 });
  });

  it('works on any storage driver (write conditions included)', async () => {
    const store = new ReplayStore(new MemoryStorage(), join(tmpdir(), 'no-samples-here'));
    await store.save(replay());
    const first = await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    await expect(store.saveEdits('test-replay', cut(100, 500), { by: 'ada@example.com', ifVersion: 'stale' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      store.saveEdits('test-replay', cut(100, 500), { by: 'ada@example.com', ifVersion: first.version! }),
    ).resolves.toMatchObject({
      edits: { revision: 2 },
    });
  });

  it('prunes the edit list with its replay, and keeps a committed sample’s', async () => {
    const { root, store } = await tempStore();
    await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    await store.saveEdits('sample-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    const old = new Date('2026-01-01');
    for (const file of ['test-replay/replay.json', 'test-replay/edits.json', 'sample-replay/edits.json'])
      await utimes(join(root, 'data', file), old, old);
    const removed = await store.prune(Date.parse('2026-10-14'));
    expect(removed).toEqual(['test-replay']);
    await expect(stat(join(root, 'data', 'test-replay', 'edits.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'data', 'sample-replay', 'edits.json'), 'utf8')).resolves.toContain('"revision":1');
  });
});

async function start(render = false, beta = true, editing?: boolean) {
  const { root, store } = await tempStore();
  const runs: Array<{ id: string; edits: string }> = [];
  const clientDir = join(root, 'client');
  const queue = new RenderQueue({
    dataDir: store.dataDir,
    runner: async (task) => {
      runs.push({ id: task.id, edits: task.edits });
      await writeFile(task.output, 'mp4');
    },
  });
  const service: RenderService = {
    tools: { available: true, chromiumPath: '/bin/chromium', ffmpegPath: 'ffmpeg' },
    queue,
    token: 'a'.repeat(43),
    clientDir,
    maxDurationMs: 60_000,
  };
  const handle = createApp({
    ...appDefaults(),
    beta: { editor: beta, malleable: false },
    ...(editing !== undefined ? { editing: { enabled: editing } } : {}),
    store,
    clientDir,
    ...(render ? { render: service } : {}),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, api: `${origin}/api/replays`, store, queue, runs };
}

const put = (url: string, origin: string, body: unknown, ifMatch?: string) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin, ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    body: JSON.stringify(body),
  });

describe('edits API', () => {
  it('serves the list with an ETag, revalidated, and 304s while unchanged', async () => {
    const { api } = await start();
    const response = await fetch(`${api}/test-replay/edits`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('etag')).toBe('"e.none"');
    await expect(response.json()).resolves.toEqual({ version: 1, cuts: [], revision: 0 });
    const again = await fetch(`${api}/test-replay/edits`, { headers: { 'if-none-match': '"e.none"' } });
    expect(again.status).toBe(304);
    expect((await fetch(`${api}/missing/edits`)).status).toBe(404);
  });

  it('saves with If-Match, records who, and answers conflicts with the current list', async () => {
    const { api, origin } = await start();
    const url = `${api}/test-replay/edits`;
    expect((await put(url, origin, cut(100, 300))).status).toBe(428);
    const saved = await put(url, origin, cut(100, 300), '"e.none"');
    expect(saved.status).toBe(200);
    const etag = saved.headers.get('etag')!;
    expect(etag).toMatch(/^"e\.[^"]+"$/);
    await expect(saved.json()).resolves.toMatchObject({
      revision: 1,
      updatedBy: 'anonymous',
      cuts: [{ id: 'c1', from: 100, to: 300 }],
    });

    // Someone else, still on "none", saves something different: 409 with what is stored now.
    const conflict = await put(url, origin, cut(200, 400), '"e.none"');
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('etag')).toBe(etag);
    await expect(conflict.json()).resolves.toMatchObject({ current: { revision: 1, cuts: [{ from: 100, to: 300 }] } });
    // Retrying the first save is a no-op.
    const retry = await put(url, origin, cut(100, 300), '"e.none"');
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ revision: 1 });
    // With the current ETag the change goes through; reverting everything is a save too.
    const next = await put(url, origin, { version: 1, cuts: [] }, etag);
    await expect(next.json()).resolves.toMatchObject({ revision: 2, cuts: [] });
    const get = await fetch(url, { headers: { 'if-none-match': etag } });
    expect(get.status).toBe(200);
  });

  it('validates, sanitizes free text and refuses cross-site writes', async () => {
    const { api, origin } = await start();
    const url = `${api}/test-replay/edits`;
    const invalid = await put(url, origin, { version: 1, cuts: [{ id: 'c', from: 900, to: 100 }] }, '"e.none"');
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain('edits.cuts[0]');
    const labelled = await put(
      url,
      origin,
      { version: 1, cuts: [{ id: 'c', from: 100, to: 300, label: 'see https://example.com/?token=secret123' }] },
      '"e.none"',
    );
    expect(labelled.status).toBe(200);
    const body = (await labelled.json()) as ReplayEdits;
    expect(body.cuts[0]!.label).not.toContain('secret123');
    const crossSite = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', 'if-match': '"e.none"' },
      body: JSON.stringify(cut(100, 300)),
    });
    expect(crossSite.status).toBe(403);
  });

  it('parses its own ETags only', () => {
    expect(versionFromEtag(editsEtag(undefined))).toBeNull();
    expect(versionFromEtag(editsEtag('abc'))).toBe('abc');
    expect(versionFromEtag('W/"e.abc"')).toBe('abc');
    expect(versionFromEtag('"something-else"')).toBeUndefined();
  });

  it('renders edited replays as their own cached variant, never the unedited video', async () => {
    const { api, origin, queue, runs } = await start(true);
    const render = `${api}/test-replay/render`;
    const post = (body: unknown) =>
      fetch(render, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    expect((await post({})).status).toBe(202);
    await queue.settled('test-replay', 1);
    expect(runs).toEqual([{ id: 'test-replay', edits: '' }]);

    const saved = await put(`${api}/test-replay/edits`, origin, cut(100, 300), '"e.none"');
    expect(saved.status).toBe(200);
    const version = editsVersion(cut(100, 300));
    // The unedited MP4 exists, but the replay is edited now: no stale video is served.
    await expect((await fetch(render)).json()).resolves.toEqual({ status: 'none' });
    expect((await fetch(`${render}/file`)).status).toBe(404);
    // A client still showing the old edits cannot start an export of them.
    expect((await post({ edits: '' })).status).toBe(409);
    const started = await post({ edits: version });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toMatchObject({ jobId: `test-replay-1x-skip-e${version}` });
    await queue.settled('test-replay', 1, { edits: version });
    expect(runs.at(-1)).toEqual({ id: 'test-replay', edits: version });
    await expect((await fetch(`${render}?edits=${version}`)).json()).resolves.toMatchObject({ status: 'done' });
    const file = await fetch(`${render}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="test-replay-edited.mp4"');
    // Naming no edits explicitly ('') still reaches the video rendered before the edits.
    await expect((await fetch(`${render}?edits=`)).json()).resolves.toMatchObject({ status: 'done' });
    expect((await fetch(`${render}?edits=NOT-OK`)).status).toBe(400);
  });
});

describe('host editing writes disabled', () => {
  it('keeps saved GET/HEAD and ETag revalidation, refusing PUT before If-Match and body parsing', async () => {
    const { api, store } = await start(false, true, false);
    const saved = await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    const url = `${api}/test-replay/edits`;
    const get = await fetch(url);
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toEqual(saved.edits);
    const etag = get.headers.get('etag')!;
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBe(etag);
    expect(await head.text()).toBe('');
    for (const method of ['GET', 'HEAD']) {
      const cached = await fetch(url, { method, headers: { 'if-none-match': etag } });
      expect(cached.status).toBe(304);
      expect(cached.headers.get('cache-control')).toBe('private, no-cache');
    }
    for (const headers of [{}, { 'if-match': etag }]) {
      const denied = await fetch(url, { method: 'PUT', headers, body: '{invalid json' });
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toEqual({ error: 'editing is turned off' });
    }
    await expect(store.readEdits('test-replay')).resolves.toEqual({ edits: saved.edits, version: saved.version });
    expect((await fetch(`${api}/missing/edits`, { method: 'PUT' })).status).toBe(404);
  });

  it('keeps trims and effects in the MP4 variant hash and internal render edit list', async () => {
    const { api, origin, store, queue, runs } = await start(true, true, false);
    const edits: ReplayEdits = {
      version: 1,
      cuts: [],
      trim: { start: 100, end: 900 },
      captions: [{ id: 'caption-1', from: 100, to: 900, text: 'Saved caption' }],
      zooms: [{ id: 'zoom-1', from: 100, to: 900, scale: 1.5 }],
    };
    await store.saveEdits('test-replay', edits, { by: 'ada@example.com', ifVersion: null });
    const version = editsVersion(edits);
    const render = `${api}/test-replay/render`;
    const response = await fetch(render, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ jobId: `test-replay-1x-skip-e${version}` });
    await queue.settled('test-replay', 1, { edits: version });
    expect(runs).toEqual([{ id: 'test-replay', edits: version }]);
    const internal = await fetch(`${origin}/internal/render/test-replay/edits.json`, { headers: { 'x-render-token': 'a'.repeat(43) } });
    expect(internal.status).toBe(200);
    await expect(internal.json()).resolves.toMatchObject(edits);
    expect((await fetch(`${render}/file`)).status).toBe(200);
    expect((await fetch(`${render}/file?edits=`)).status).toBe(404);
  });

  it('advertises effective write capability independently of the beta flag', async () => {
    for (const [beta, enabled, effective] of [
      [true, false, false],
      [true, true, true],
      [false, true, false],
    ] as const) {
      const { origin } = await start(false, beta, enabled);
      await expect((await fetch(`${origin}/api/config`)).json()).resolves.toMatchObject({
        beta: { editor: beta },
        editing: { enabled: effective },
      });
    }
  });
});

describe('edits API with the beta flag off (the default)', () => {
  it('has no edits routes: every method answers the generic API 404', async () => {
    const { api, origin } = await start(false, false);
    const url = `${api}/test-replay/edits`;
    expect((await fetch(url)).status).toBe(404);
    await expect((await fetch(url)).json()).resolves.toEqual({ error: 'not found' });
    expect((await put(url, origin, cut(100, 300), '"e.none"')).status).toBe(404);
  });

  it('reports the flag in /api/config, off by default and on when enabled', async () => {
    const off = await start(false, false);
    await expect((await fetch(`${off.origin}/api/config`)).json()).resolves.toMatchObject({ beta: { editor: false } });
    const on = await start(false, true);
    await expect((await fetch(`${on.origin}/api/config`)).json()).resolves.toMatchObject({ beta: { editor: true } });
  });

  it('exports render the replay as recorded even when an edit list sits in storage', async () => {
    const { api, origin, queue, runs, store } = await start(true, false);
    await store.saveEdits('test-replay', cut(100, 300), { by: 'ada@example.com', ifVersion: null });
    const post = (body: unknown) =>
      fetch(`${api}/test-replay/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      });
    expect((await post({ edits: editsVersion(cut(100, 300)) })).status).toBe(202);
    await queue.settled('test-replay', 1);
    expect(runs).toEqual([{ id: 'test-replay', edits: '' }]);
  });
});

describe('render variants with edits', () => {
  it('names files, queries and state files by the edit list version', () => {
    expect(renderVariant(1, { edits: 'abc123' })).toBe('1x-skip-eabc123');
    expect(renderVariant(2, { skipInactive: false, captions: true })).toBe('2x-cc');
    expect(parseStateFile('render-1x-skip-cc-eabc123.json')).toEqual({
      speed: 1,
      options: { skipInactive: true, captions: true, edits: 'abc123' },
    });
    expect(parseStateFile('render-1x-skip.json')).toEqual({ speed: 1, options: { skipInactive: true, captions: false, edits: '' } });
    expect(renderFilename('tracker', { speed: 2, edits: 'abc' })).toBe('tracker-edited-2x.mp4');
    expect(renderQuery({ edits: 'abc' })).toBe('?edits=abc');
    expect(renderQuery({ edits: '' })).toBe('');
  });
});
