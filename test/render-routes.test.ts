import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { type RenderRunner, RenderQueue } from '../src/server/render-queue.ts';
import { isRendererRequest, parseFlag, parseSpeed, type RenderService } from '../src/server/render-routes.ts';
import { chromiumArgs, detectRenderTools, ffmpegArgs } from '../src/server/renderer.ts';
import { ReplayStore } from '../src/server/store.ts';
import { PLAYBACK_SPEEDS } from '../src/shared/render-variant.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const TOKEN = 'a'.repeat(43);
const available = { available: true, chromiumPath: '/bin/chromium', ffmpegPath: 'ffmpeg' };

async function start(options: { closed?: boolean; render?: 'on' | 'off' | 'none'; runner?: RenderRunner } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replays-render-routes-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const clientDir = join(root, 'client');
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await writeFile(join(clientDir, 'render.html'), '<script src="./assets/render.js"></script>');
  await writeFile(join(clientDir, 'assets', 'render.js'), 'console.log(1)');
  const runs: string[] = [];
  const queue = new RenderQueue({
    dataDir: store.dataDir,
    runner:
      options.runner ??
      (async (task) => {
        runs.push(task.id);
        await writeFile(task.output, 'mp4-bytes');
      }),
  });
  const mode = options.render ?? 'on';
  const render: RenderService | undefined =
    mode === 'none'
      ? undefined
      : mode === 'on'
        ? { tools: available, queue, token: TOKEN, clientDir, maxDurationMs: 60_000 }
        : {
            tools: { available: false, reason: 'ffmpeg not found (ffmpeg)', ffmpegPath: 'ffmpeg' },
            token: TOKEN,
            clientDir,
            maxDurationMs: 60_000,
          };
  const handle = createApp({
    ...appDefaults(),
    ...(options.closed ? { auth: { name: 'closed', authenticate: () => undefined } } : {}),
    store,
    clientDir,
    ...(render ? { render } : {}),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { origin: `http://127.0.0.1:${address.port}`, queue, runs };
}

const post = (url: string, origin: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

describe('render job API', () => {
  it('starts, reports and serves a render', async () => {
    const { origin, queue, runs } = await start();
    const endpoint = `${origin}/api/replays/test-replay/render`;
    // Not rendered yet: an expected answer (200 { status: 'none' }), so the viewer's probe logs no error.
    await expect((await fetch(endpoint)).json()).resolves.toEqual({ status: 'none' });

    const started = await post(endpoint, origin, { speed: 1 });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toMatchObject({ jobId: 'test-replay-1x-skip' });
    await queue.settled('test-replay', 1);

    await expect((await fetch(endpoint)).json()).resolves.toMatchObject({ status: 'done', progress: 1, size: 9 });
    const again = await post(endpoint, origin);
    expect(again.status).toBe(200);
    expect(runs).toEqual(['test-replay']);

    const head = await fetch(`${endpoint}/file`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('video/mp4');
    const file = await fetch(`${endpoint}/file`);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="test-replay.mp4"');
    await expect(file.text()).resolves.toBe('mp4-bytes');
  });

  it('renders and serves the captioned variant separately (body captions, ?captions=1)', async () => {
    const { origin, queue } = await start();
    const runs: Array<[string, boolean]> = [];
    const endpoint = `${origin}/api/replays/test-replay/render`;
    const original = queue.enqueue.bind(queue);
    queue.enqueue = (id, speed, options) => {
      runs.push([`${id}@${speed}`, Boolean(options?.captions)]);
      return original(id, speed, options);
    };
    const started = await post(endpoint, origin, { speed: 1, captions: true });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toMatchObject({ jobId: 'test-replay-1x-skip-cc' });
    await queue.settled('test-replay', 1, { captions: true });
    expect(runs).toEqual([['test-replay@1', true]]);
    // Without the flag (older clients) it is the plain variant, which has not been rendered.
    await expect((await fetch(endpoint)).json()).resolves.toEqual({ status: 'none' });
    await expect((await fetch(`${endpoint}?captions=1`)).json()).resolves.toMatchObject({
      jobId: 'test-replay-1x-skip-cc',
      status: 'done',
    });
    expect((await fetch(`${endpoint}/file`)).status).toBe(404);
    const file = await fetch(`${endpoint}/file?captions=1`);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="test-replay-captions.mp4"');
    expect((await post(endpoint, origin, { captions: false })).status).toBe(202);
    expect(runs.at(-1)).toEqual(['test-replay@1', false]);
  });

  it('accepts the viewer speeds and skip inactive, each its own job and file', async () => {
    const { origin, queue } = await start();
    const endpoint = `${origin}/api/replays/test-replay/render`;
    for (const speed of [0.5, 1.5, 4, 8]) expect(parseSpeed(speed)).toBe(speed);
    expect(parseSpeed('2')).toBe(2);
    expect(parseSpeed(undefined)).toBe(1);
    for (const bad of [3, 0, -1, 'fast', 16]) expect(parseSpeed(bad)).toBeUndefined();
    const started = await post(endpoint, origin, { speed: 2, skipInactive: false, captions: true });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toMatchObject({ jobId: 'test-replay-2x-cc' });
    await queue.settled('test-replay', 2, { skipInactive: false, captions: true });
    const query = '?speed=2&skipInactive=0&captions=1';
    await expect((await fetch(`${endpoint}${query}`)).json()).resolves.toMatchObject({ status: 'done' });
    // Absent skipInactive means on (the player's default): another variant, not rendered yet.
    await expect((await fetch(`${endpoint}?speed=2&captions=1`)).json()).resolves.toEqual({ status: 'none' });
    const file = await fetch(`${endpoint}/file${query}`);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="test-replay-2x-full-captions.mp4"');
    expect((await post(endpoint, origin, { skipInactive: 'sometimes' })).status).toBe(400);
    expect((await post(endpoint, origin, { speed: 3 })).status).toBe(400);
  });

  it.each(PLAYBACK_SPEEDS)('accepts %sx throughout the render lifecycle, keeping variants separate', async (speed) => {
    const { origin, queue } = await start();
    const endpoint = `${origin}/api/replays/test-replay/render`;
    const options = { skipInactive: false, captions: true };
    const query = `?speed=${speed}&skipInactive=0&captions=1`;
    expect((await post(endpoint, origin, { speed, ...options })).status).toBe(202);
    await queue.settled('test-replay', speed, options);
    const status = await fetch(`${endpoint}${query}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ status: 'done' });
    await expect((await fetch(`${endpoint}?speed=${speed}`)).json()).resolves.toEqual({ status: 'none' });
    const file = await fetch(`${endpoint}/file${query}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe(
      `attachment; filename="test-replay${speed === 1 ? '' : `-${speed}x`}-full-captions.mp4"`,
    );
    // The completed variant is accepted by DELETE as well (there is no running job to cancel).
    expect((await fetch(`${endpoint}${query}`, { method: 'DELETE', headers: { origin } })).status).toBe(404);
  });

  it.each(PLAYBACK_SPEEDS)('cancels an active %sx variant without cancelling another variant', async (speed) => {
    const { origin, queue } = await start({
      runner: (task) =>
        new Promise<void>((_resolve, reject) => {
          task.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
    });
    const endpoint = `${origin}/api/replays/test-replay/render`;
    expect((await post(endpoint, origin, { speed, captions: true })).status).toBe(202);
    expect((await fetch(`${endpoint}?speed=${speed}`, { method: 'DELETE', headers: { origin } })).status).toBe(404);
    const cancelled = await fetch(`${endpoint}?speed=${speed}&captions=1`, { method: 'DELETE', headers: { origin } });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({ cancelled: true });
    await queue.settled('test-replay', speed, { captions: true });
  });

  it('parses on/off flags, absent meaning the given default', () => {
    for (const off of [undefined, null, '', false, 0, '0', 'false']) expect(parseFlag(off)).toBe(false);
    for (const absent of [undefined, null, '']) expect(parseFlag(absent, true)).toBe(true);
    for (const off of [false, 0, '0', 'false']) expect(parseFlag(off, true)).toBe(false);
    for (const on of [true, 1, '1', 'true']) expect(parseFlag(on)).toBe(true);
    for (const bad of ['yes', 2, {}, []]) expect(parseFlag(bad)).toBeUndefined();
  });

  it('validates speed, replay and length, and cancels', async () => {
    const { origin } = await start();
    const base = `${origin}/api/replays`;
    expect((await post(`${base}/test-replay/render`, origin, { speed: 3 })).status).toBe(400);
    expect((await post(`${base}/test-replay/render`, origin, { captions: 'yes' })).status).toBe(400);
    expect((await fetch(`${base}/test-replay/render?captions=maybe`)).status).toBe(400);
    expect((await post(`${base}/missing/render`, origin)).status).toBe(404);
    expect((await fetch(`${base}/test-replay/render`, { method: 'DELETE', headers: { origin } })).status).toBe(404);
  });

  it('refuses replays above the duration cap', async () => {
    const { origin } = await start();
    const long = replay('long-replay');
    long.meta.duration = 120_000;
    await fetch(`${origin}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(long),
    });
    const response = await post(`${origin}/api/replays/long-replay/render`, origin);
    expect(response.status).toBe(422);
  });

  it('says "unavailable" to the status probe and answers 503 to the rest when Chromium or ffmpeg is missing, or rendering is not configured', async () => {
    for (const render of ['off', 'none'] as const) {
      const { origin } = await start({ render });
      // The viewer probes on every load: an expected answer, not an error status.
      const response = await fetch(`${origin}/api/replays/test-replay/render`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'unavailable' });
      expect((await post(`${origin}/api/replays/test-replay/render`, origin)).status).toBe(503);
      expect((await fetch(`${origin}/api/replays/test-replay/render/file`)).status).toBe(503);
    }
  });

  it('keeps the job routes behind sign-in', async () => {
    const { origin } = await start({ closed: true });
    expect((await fetch(`${origin}/api/replays/test-replay/render`)).status).toBe(403);
    expect((await fetch(`${origin}/api/replays/test-replay/render/file`)).status).toBe(403);
    expect((await post(`${origin}/api/replays/test-replay/render`, origin)).status).toBe(403);
  });

  it('rejects cross-site POSTs', async () => {
    const { origin } = await start();
    const response = await fetch(`${origin}/api/replays/test-replay/render`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status).toBe(403);
  });
});

describe('internal render page', () => {
  const headers = { 'x-render-token': TOKEN };

  it('serves the page, its assets and the bundle to the renderer only', async () => {
    const { origin } = await start({ closed: true });
    const page = await fetch(`${origin}/internal/render/test-replay`, { headers });
    expect(page.status).toBe(200);
    // Built asset URLs are relative (vite.config.ts): from /internal/render/<id> they load from the route below.
    await expect(page.text()).resolves.toContain('src="./assets/render.js"');
    expect(new URL('./assets/render.js', `${origin}/internal/render/test-replay`).pathname).toBe('/internal/render/assets/render.js');
    expect((await fetch(`${origin}/internal/render/assets/render.js`, { headers })).status).toBe(200);
    const bundle = await fetch(`${origin}/internal/render/test-replay/bundle.json`, { headers });
    await expect(bundle.json()).resolves.toMatchObject({ meta: { id: 'test-replay' } });
  });

  it('refuses a missing or wrong token', async () => {
    const { origin } = await start();
    expect((await fetch(`${origin}/internal/render/test-replay`)).status).toBe(404);
    expect((await fetch(`${origin}/internal/render/test-replay`, { headers: { 'x-render-token': 'b'.repeat(43) } })).status).toBe(404);
    expect((await fetch(`${origin}/internal/render/test-replay/bundle.json`, { headers: { 'x-render-token': 'short' } })).status).toBe(404);
  });

  it('refuses proxied requests even with the token (a reverse proxy in front)', async () => {
    const { origin } = await start();
    for (const header of ['x-forwarded-for', 'forwarded']) {
      expect((await fetch(`${origin}/internal/render/test-replay`, { headers: { ...headers, [header]: '1.2.3.4' } })).status).toBe(404);
    }
  });

  it('refuses non-loopback peers', () => {
    const request = (remoteAddress: string) =>
      ({ socket: { remoteAddress }, headers: { 'x-render-token': TOKEN } }) as unknown as IncomingMessage;
    expect(isRendererRequest(request('127.0.0.1'), TOKEN)).toBe(true);
    expect(isRendererRequest(request('::1'), TOKEN)).toBe(true);
    expect(isRendererRequest(request('10.0.0.8'), TOKEN)).toBe(false);
    expect(isRendererRequest(request('::ffff:10.0.0.8'), TOKEN)).toBe(false);
    expect(isRendererRequest(request('127.0.0.1'), '')).toBe(false);
  });

  it('is off without a render service', async () => {
    const { origin } = await start({ render: 'none' });
    expect((await fetch(`${origin}/internal/render/test-replay`, { headers })).status).toBe(404);
  });
});

describe('render tooling', () => {
  it('reports missing tools without throwing', async () => {
    const tools = await detectRenderTools({ CHROMIUM_PATH: '/nonexistent/chromium', FFMPEG_PATH: '/nonexistent/ffmpeg' });
    expect(tools).toMatchObject({ available: false, reason: expect.stringContaining('Chromium') });
    expect(await detectRenderTools({ RENDER_DISABLED: '1' })).toMatchObject({ available: false });
  });

  it('only drops the Chromium sandbox when asked', () => {
    expect(chromiumArgs({})).not.toContain('--no-sandbox');
    expect(chromiumArgs({ CHROMIUM_NO_SANDBOX: '1' })).toContain('--no-sandbox');
  });

  it('encodes H.264 yuv420p with faststart', () => {
    const args = ffmpegArgs({ fps: 30, crf: 23, output: '/tmp/x.mp4' }).join(' ');
    expect(args).toContain('-c:v libx264');
    expect(args).toContain('format=yuv420p');
    expect(args).toContain('-movflags +faststart');
    expect(args).toContain('-framerate 30');
  });
});
