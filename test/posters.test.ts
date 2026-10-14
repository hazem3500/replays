import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { PosterQueue, type PosterRunner, previewFfmpegArgs } from '../src/server/posters.ts';
import type { RenderService } from '../src/server/render-routes.ts';
import { FsStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const MP4 = Buffer.from('0123456789abcdef');
const OPEN_JPEG = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]);

async function start(
  options: {
    posters?: 'on' | 'off';
    previews?: boolean;
    opens?: boolean;
    closed?: boolean;
    runner?: PosterRunner;
    busy?: () => boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'replay-kit-posters-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const runs: string[] = [];
  const previewRuns: string[] = [];
  const openRuns: string[] = [];
  const posters = new PosterQueue({
    storage: store.storage,
    key: (id) => store.posterKey(id),
    ...(options.opens
      ? {
          open: {
            key: (id: string) => store.openStillKey(id),
            runner: async (task: { id: string; output: string }) => {
              openRuns.push(task.id);
              await writeFile(task.output, OPEN_JPEG);
            },
          },
        }
      : {}),
    ...(options.previews
      ? {
          preview: {
            key: (id: string) => store.previewKey(id),
            runner: async (task: { id: string; output: string }) => {
              previewRuns.push(task.id);
              await writeFile(task.output, MP4);
              await writeFile(`${task.output}.json`, JSON.stringify({ capped: true, coveredMs: 45_000, speed: 3 }));
            },
          },
        }
      : {}),
    waitMs: 5,
    ...(options.busy ? { busy: options.busy } : {}),
    runner:
      options.runner ??
      (async (task) => {
        runs.push(task.id);
        await writeFile(task.output, JPEG);
        // Like the real poster runner: the page loads at t = 0, so the opening still comes along.
        await writeFile(`${task.output}.open.jpg`, OPEN_JPEG);
      }),
  });
  const render: RenderService = {
    tools: { available: false, reason: 'ffmpeg not found (ffmpeg)', chromiumPath: '/bin/chromium', ffmpegPath: 'ffmpeg' },
    token: 'a'.repeat(43),
    clientDir: root,
    maxDurationMs: 60_000,
    ...(options.posters === 'off' ? {} : { posters }),
  };
  const handle = createApp({
    ...appDefaults(),
    ...(options.closed ? { auth: { name: 'closed', authenticate: () => undefined } } : {}),
    store,
    clientDir: root,
    render,
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    store,
    posters,
    runs,
    previewRuns,
    openRuns,
    openUrl: (id = 'test-replay') => `${origin}/api/replays/${id}/open`,
    url: (id = 'test-replay') => `${origin}/api/replays/${id}/poster`,
    previewUrl: (id = 'test-replay') => `${origin}/api/replays/${id}/preview`,
  };
}

describe('poster API', () => {
  it('answers 202 while generating, then serves a cached JPEG with a weak ETag', async () => {
    const { url, posters, runs, store } = await start();
    const pending = await fetch(url());
    expect(pending.status).toBe(202);
    expect(pending.headers.get('retry-after')).toBe('2');
    expect(pending.headers.get('cache-control')).toBe('no-store');
    await posters.settled('test-replay');
    expect(runs).toEqual(['test-replay']);
    await expect(readFile(store.posterFile('test-replay'))).resolves.toEqual(JPEG);

    const ready = await fetch(url());
    expect(ready.status).toBe(200);
    expect(ready.headers.get('content-type')).toBe('image/jpeg');
    expect(ready.headers.get('cache-control')).toBe('private, max-age=604800');
    const etag = ready.headers.get('etag')!;
    expect(etag).toMatch(/^W\//);
    expect(Buffer.from(await ready.arrayBuffer())).toEqual(JPEG);
    expect((await fetch(url(), { headers: { 'if-none-match': etag } })).status).toBe(304);
    expect((await fetch(url(), { method: 'HEAD' })).status).toBe(200);
    expect(runs).toHaveLength(1);
  });

  it('needs a signed-in user like the rest of the API', async () => {
    const { url, runs } = await start({ closed: true });
    expect((await fetch(url())).status).toBe(403);
    expect(runs).toEqual([]);
  });

  it('is 404 for unknown replays and 503 when posters are off', async () => {
    const on = await start();
    expect((await fetch(on.url('no-such-replay'))).status).toBe(404);
    expect((await fetch(on.url('Bad_Id'))).status).toBe(404);
    const off = await start({ posters: 'off' });
    const unavailable = await fetch(off.url());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('retry-after')).toBeNull();
    // A poster made earlier is still served.
    await writeFile(off.store.posterFile('test-replay'), JPEG);
    expect((await fetch(off.url())).status).toBe(200);
  });

  it('remembers a failed poster instead of retrying on every request', async () => {
    let calls = 0;
    const { url, posters } = await start({
      runner: async () => {
        calls++;
        throw new Error('render page failed');
      },
    });
    expect((await fetch(url())).status).toBe(202);
    await posters.settled('test-replay');
    expect((await fetch(url())).status).toBe(404);
    expect(calls).toBe(1);
  });

  it('is generated eagerly after an upload, without blocking it', async () => {
    const { origin, posters, runs } = await start();
    const bundle = replay('uploaded-now');
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(bundle),
    });
    expect(response.status).toBe(201);
    // The upload answers before its media are queued: poll for the run rather than settling a job that may not exist yet.
    await expect.poll(() => runs.includes('uploaded-now')).toBe(true);
    await posters.settled('uploaded-now');
  });
});

describe('opening still API', () => {
  it('comes with the poster job (no second render), then is served like a poster', async () => {
    const { url, openUrl, posters, runs, openRuns, store } = await start({ opens: true });
    expect((await fetch(url())).status).toBe(202);
    await posters.settled('test-replay');
    expect(runs).toEqual(['test-replay']);
    await expect(readFile(store.openStillFile('test-replay'))).resolves.toEqual(OPEN_JPEG);
    const ready = await fetch(openUrl());
    expect(ready.status).toBe(200);
    expect(ready.headers.get('content-type')).toBe('image/jpeg');
    expect(ready.headers.get('cache-control')).toBe('private, max-age=604800');
    const etag = ready.headers.get('etag')!;
    expect(etag).toMatch(/^W\//);
    expect(Buffer.from(await ready.arrayBuffer())).toEqual(OPEN_JPEG);
    expect((await fetch(openUrl(), { headers: { 'if-none-match': etag } })).status).toBe(304);
    expect((await fetch(openUrl(), { method: 'HEAD' })).status).toBe(200);
    expect(openRuns).toEqual([]);
  });

  it('is made lazily on its own for a replay whose poster predates it, and warmed when the poster is served', async () => {
    const { url, openUrl, posters, openRuns, store } = await start({ opens: true });
    await writeFile(store.posterFile('test-replay'), JPEG);
    // Serving the (old) poster queues the missing opening still in the background.
    expect((await fetch(url())).status).toBe(200);
    await expect.poll(() => openRuns).toEqual(['test-replay']);
    await posters.settled('test-replay', 'open');
    expect((await fetch(openUrl())).status).toBe(200);
    // A direct request for a missing one answers 202 while it renders, like a poster.
    const other = await start({ opens: true, runner: async (task) => void (await writeFile(task.output, JPEG)) });
    await writeFile(other.store.posterFile('test-replay'), JPEG);
    const pending = await fetch(other.openUrl());
    expect(pending.status).toBe(202);
    expect(pending.headers.get('retry-after')).toBe('2');
    await other.posters.settled('test-replay', 'open');
    expect((await fetch(other.openUrl())).status).toBe(200);
  });

  it('is queued after an upload and done by its poster job', async () => {
    const { origin, posters, runs, openRuns, store } = await start({ opens: true });
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(replay('fresh-open')),
    });
    expect(response.status).toBe(201);
    // Same race as above: the jobs are queued after the upload answers.
    await expect.poll(() => runs.includes('fresh-open')).toBe(true);
    await posters.settled('fresh-open');
    await posters.settled('fresh-open', 'open');
    expect(openRuns).not.toContain('fresh-open');
    await expect(readFile(store.openStillFile('fresh-open'))).resolves.toEqual(OPEN_JPEG);
  });

  it('is 503 when stills are off, and pruned with its replay', async () => {
    const off = await start();
    expect((await fetch(off.openUrl())).status).toBe(503);
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-posters-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 1);
    await store.save(replay('old-open'));
    await writeFile(store.openStillFile('old-open'), OPEN_JPEG);
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await utimes(join(root, 'data', 'old-open', 'replay.json'), old, old);
    await expect(store.prune()).resolves.toEqual(['old-open']);
    await expect(stat(store.openStillFile('old-open'))).rejects.toThrow(/ENOENT/);
  });
});

describe('PosterQueue', () => {
  it('runs one poster at a time, waits while busy, and dedupes requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-posters-'));
    let busy = true;
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const queue = new PosterQueue({
      storage: new FsStorage(root),
      key: (id) => `${id}/poster.jpg`,
      busy: () => busy,
      waitMs: 5,
      runner: async (task) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(task.id);
        await writeFile(task.output, JPEG);
        running--;
      },
    });
    await expect(queue.request('a')).resolves.toBe('pending');
    await expect(queue.request('a')).resolves.toBe('pending');
    await expect(queue.request('b')).resolves.toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual([]);
    busy = false;
    await queue.settled('a');
    await queue.settled('b');
    expect(order).toEqual(['a', 'b']);
    expect(peak).toBe(1);
    await expect(stat(join(root, 'a', 'poster.jpg'))).resolves.toBeTruthy();
    await expect(queue.request('a')).resolves.toBe('ready');
  });

  it('reports a full queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-posters-'));
    let busy = true;
    const queue = new PosterQueue({
      storage: new FsStorage(root),
      key: (id) => `${id}/poster.jpg`,
      busy: () => busy,
      waitMs: 5,
      maxQueued: 1,
      runner: async () => {},
    });
    await expect(queue.request('a')).resolves.toBe('pending');
    // `a` is taken off the waiting list only when the queue is not busy.
    await expect(queue.request('b')).resolves.toBe('full');
    busy = false;
    await queue.settled('a');
  });
});

describe('preview API', () => {
  it('is 503 without ffmpeg (posters-only), so the UI keeps the poster', async () => {
    const { previewUrl, previewRuns } = await start();
    const response = await fetch(previewUrl(), { method: 'HEAD' });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBeNull();
    expect(previewRuns).toEqual([]);
  });

  it('answers 202, then serves the MP4 with byte ranges and its span as headers', async () => {
    const { previewUrl, posters, previewRuns, store } = await start({ previews: true });
    expect((await fetch(previewUrl('no-such-replay'), { method: 'HEAD' })).status).toBe(404);
    const pending = await fetch(previewUrl(), { method: 'HEAD' });
    expect(pending.status).toBe(202);
    expect(pending.headers.get('retry-after')).toBe('2');
    await posters.settled('test-replay', 'preview');
    expect(previewRuns).toEqual(['test-replay']);

    const head = await fetch(previewUrl(), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('video/mp4');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect(head.headers.get('x-preview-speed')).toBe('3');
    expect(head.headers.get('x-preview-capped')).toBe('1');
    expect(head.headers.get('x-preview-covers-ms')).toBe('45000');
    const part = await fetch(previewUrl(), { headers: { range: 'bytes=4-7' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 4-7/16');
    expect(await part.text()).toBe('4567');
    const tail = await fetch(previewUrl(), { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('def');
    expect((await fetch(previewUrl(), { headers: { range: 'bytes=99-' } })).status).toBe(416);
    expect((await fetch(previewUrl())).status).toBe(200);
    await expect(stat(store.previewFile('test-replay'))).resolves.toBeTruthy();
  });

  it('is made after an upload, after its poster, and warmed when a poster is served', async () => {
    const { origin, posters, runs, previewRuns, url } = await start({ previews: true });
    const response = await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(replay('fresh-upload')),
    });
    expect(response.status).toBe(201);
    // The upload queues its media after answering, so the jobs may not exist yet: wait for them to run.
    await expect.poll(() => runs.includes('fresh-upload')).toBe(true);
    await expect.poll(() => previewRuns.includes('fresh-upload')).toBe(true);
    await posters.settled('fresh-upload', 'preview');

    // The older replay: its poster is served, which queues its preview in the background.
    await fetch(url());
    await posters.settled('test-replay');
    expect((await fetch(url())).status).toBe(200);
    await expect.poll(() => previewRuns.includes('test-replay')).toBe(true);
  });

  it('is pruned with its replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-posters-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 1);
    await store.save(replay('old-preview'));
    await writeFile(store.previewFile('old-preview'), MP4);
    await writeFile(`${store.previewFile('old-preview')}.json`, '{}');
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await utimes(join(root, 'data', 'old-preview', 'replay.json'), old, old);
    await expect(store.prune()).resolves.toEqual(['old-preview']);
    await expect(stat(store.previewFile('old-preview'))).rejects.toThrow(/ENOENT/);
  });

  it('builds a small silent H.264 clip', () => {
    const args = previewFfmpegArgs('/tmp/out.mp4').join(' ');
    expect(args).toContain('-framerate 15');
    expect(args).toContain('-crf 32');
    expect(args).toContain('-an');
    expect(args).toContain('-movflags +faststart');
  });
});
