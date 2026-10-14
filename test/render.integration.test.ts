/**
 * Renders a real replay with headless Chromium + ffmpeg when both are present
 * (skipped otherwise, e.g. in CI without them) and checks the video's format,
 * its length and, when the replay has an agent screen recording next to it, a few
 * frames against that recording: the fidelity check.
 *
 * Needs `pnpm build` (dist/client/render.html) and the committed sample
 * `sample/demo-shop.json`. RENDER_REPLAY=<id> renders another committed sample
 * instead (timing only). Set CHROMIUM_PATH (and CHROMIUM_NO_SANDBOX=1 in a container) when Chromium is
 * not in a standard place; ffmpeg comes from the PATH or FFMPEG_PATH.
 * The captions check renders the same replay with and without step captions and
 * compares a frame mid-step.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { exportMap } from '../src/client/render/frames.ts';
import { createApp } from '../src/server/app.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import { createRenderer, detectRenderTools, type RenderStats, renderToken } from '../src/server/renderer.ts';
import { ReplayStore } from '../src/server/store.ts';
import { idleGaps } from '../src/shared/skip.ts';
import { appDefaults } from './fixtures.ts';

const root = resolve(import.meta.dirname, '..');
const id = process.env.RENDER_REPLAY ?? 'demo-shop';
const sample = join(root, 'sample', `${id}.json`);
const tools = await detectRenderTools();
const ready =
  tools.available &&
  (await stat(join(root, 'dist/client/render.html')).catch(() => undefined)) !== undefined &&
  (await stat(sample).catch(() => undefined)) !== undefined;

/** Grayscale 160×100 frame at `seconds`, for a coarse mean-pixel-difference comparison. */
function grayFrame(file: string, seconds: number) {
  const result = spawnSync(
    tools.ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=160:100',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    { maxBuffer: 1 << 20 },
  );
  return result.stdout;
}

/** Grayscale strip (bottom 12 % or the rest above it) of the frame at `seconds`, 160 px wide. */
function grayStrip(file: string, seconds: number, part: 'bottom' | 'top') {
  const crop = part === 'bottom' ? 'crop=iw:ih*0.12:0:ih*0.88' : 'crop=iw:ih*0.88:0:0';
  const result = spawnSync(
    tools.ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `${crop},scale=160:-2`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    { maxBuffer: 1 << 20 },
  );
  return result.stdout;
}

function meanDiff(a: Buffer, b: Buffer) {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / length;
}

function probe(file: string) {
  const result = spawnSync(
    tools.ffmpegPath.replace(/ffmpeg$/, 'ffprobe'),
    ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  return JSON.parse(result.stdout || '{}') as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterAll(() => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))));

describe.skipIf(!ready)('server-side render (Chromium + ffmpeg)', () => {
  it('cancels a running render cleanly (no EPIPE crash, no file left)', { timeout: 120_000 }, async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), 'replay-kit-render-cancel-')), 'data');
    await mkdir(join(dataDir, id), { recursive: true });
    await copyFile(sample, join(dataDir, id, 'replay.json'));
    const store = new ReplayStore(dataDir, join(dataDir, '..', 'sample'));
    const token = renderToken();
    let origin = '';
    const queue = new RenderQueue({
      dataDir,
      runner: createRenderer({ origin: () => origin, token, tools, fps: 30, pageUrl: (replay) => `${origin}/internal/render/${replay}` }),
    });
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'dist/client'),
      render: { tools, queue, token, clientDir: join(root, 'dist/client'), maxDurationMs: 60 * 60_000 },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    await queue.enqueue(id, 1);
    // Cancel once frames are flowing into ffmpeg.
    for (let i = 0; i < 200 && ((await queue.status(id, 1))?.progress ?? 0) < 0.1; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await queue.cancel(id, 1)).toBe(true);
    await queue.settled(id, 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await queue.status(id, 1)).toBeUndefined();
    await expect(stat(queue.outputFile(id, 1))).rejects.toThrow(/ENOENT/);
  });

  it(`renders ${id} at 15 fps in the native viewport`, { timeout: 600_000 }, async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), 'replay-kit-render-')), 'data');
    await mkdir(join(dataDir, id), { recursive: true });
    await copyFile(sample, join(dataDir, id, 'replay.json'));
    const store = new ReplayStore(dataDir, join(dataDir, '..', 'sample'));
    const token = renderToken();
    let origin = '';
    let stats: RenderStats | undefined;
    const queue = new RenderQueue({
      dataDir,
      runner: createRenderer({
        origin: () => origin,
        token,
        tools,
        fps: 15,
        pageUrl: (replay) => `${origin}/internal/render/${replay}`,
        onFinish: (value) => (stats = value),
      }),
    });
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'dist/client'),
      render: { tools, queue, token, clientDir: join(root, 'dist/client'), maxDurationMs: 60 * 60_000 },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    origin = `http://127.0.0.1:${address.port}`;

    // Peak resident memory of this process's descendants (Chromium, ffmpeg), sampled while rendering.
    let peakChildRssKb = 0;
    const sampler = setInterval(() => {
      const rows = (spawnSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).stdout ?? '')
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number) as [number, number, number]);
      const family = new Set([process.pid]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const [pid, ppid] of rows) {
          if (family.has(ppid) && !family.has(pid)) {
            family.add(pid);
            grew = true;
          }
        }
      }
      family.delete(process.pid);
      const total = rows.reduce((sum, [pid, , rss]) => (family.has(pid) ? sum + rss : sum), 0);
      peakChildRssKb = Math.max(peakChildRssKb, total);
    }, 250);
    const started = Date.now();
    const post = await fetch(`${origin}/api/replays/${id}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      // Full idle time, so frames line up with the agent's own recording.
      body: JSON.stringify({ speed: 1, skipInactive: false }),
    });
    expect(post.status).toBe(202);
    await queue.settled(id, 1, { skipInactive: false });
    clearInterval(sampler);
    const elapsed = Date.now() - started;
    const status = (await (await fetch(`${origin}/api/replays/${id}/render?skipInactive=0`)).json()) as {
      status: string;
      error?: string;
    };
    expect(status).toMatchObject({ status: 'done' });

    const file = await fetch(`${origin}/api/replays/${id}/render/file?skipInactive=0`);
    expect(file.headers.get('content-type')).toBe('video/mp4');
    expect(file.headers.get('content-disposition')).toBe(`attachment; filename="${id}-full.mp4"`);
    const output = queue.outputFile(id, 1, { skipInactive: false });
    const info = probe(output);
    const { viewport } = (JSON.parse(await readFile(sample, 'utf8')) as { meta: { viewport: { width: number; height: number } } }).meta;
    // Native viewport, 1:1 (rounded up to even for yuv420p).
    expect(info.streams?.[0]).toMatchObject({
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      width: Math.ceil(viewport.width / 2) * 2,
      height: Math.ceil(viewport.height / 2) * 2,
    });

    const report: Record<string, unknown> = {
      replaySeconds: stats && stats.replayMs / 1000,
      renderSeconds: elapsed / 1000,
      frames: stats?.frames,
      captured: stats?.captured,
      framesPerSecond: stats && Math.round((stats.frames / (stats.durationMs / 1000)) * 10) / 10,
      size: (await stat(output)).size,
      video: info.streams?.[0],
      peakNodeRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
      peakBrowserAndFfmpegRssMb: Math.round(peakChildRssKb / 1024),
    };
    // Fidelity: grayscale mean absolute pixel difference (0–255) against the agent's own recording, when there is one.
    // The agent recording starts a moment before rrweb's first event, so frames line up only roughly.
    const agent = join(dirname(sample), `${id}.mp4`);
    const hasAgentVideo = (await stat(agent).catch(() => undefined)) !== undefined;
    const diffs = hasAgentVideo
      ? [2, 5, 8, 11].map((at) => Math.round(meanDiff(grayFrame(output, at), grayFrame(agent, at)) * 10) / 10)
      : [];
    report.meanPixelDiff = diffs;
    expect(diffs.every((diff) => diff < 40)).toBe(true);
    if (process.env.RENDER_KEEP) await copyFile(output, process.env.RENDER_KEEP);
    console.log('render report', JSON.stringify(report));
  });
});

const captionsId = 'demo-shop';
const captionsSample = join(root, 'sample', `${captionsId}.json`);
const captionsReady = ready && (await stat(captionsSample).catch(() => undefined)) !== undefined;

describe.skipIf(!captionsReady)('server-side render with step captions', () => {
  it(`draws the step caption into ${captionsId} only when asked`, { timeout: 300_000 }, async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), 'replay-kit-render-captions-')), 'data');
    await mkdir(join(dataDir, captionsId), { recursive: true });
    await copyFile(captionsSample, join(dataDir, captionsId, 'replay.json'));
    const store = new ReplayStore(dataDir, join(dataDir, '..', 'sample'));
    const token = renderToken();
    let origin = '';
    const captured: Record<string, number> = {};
    const queue = new RenderQueue({
      dataDir,
      concurrency: 2,
      runner: (task) =>
        createRenderer({
          origin: () => origin,
          token,
          tools,
          fps: 15,
          pageUrl: (replay) => `${origin}/internal/render/${replay}`,
          onFinish: (stats) => (captured[String(task.captions)] = stats.captured),
        })(task),
    });
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'dist/client'),
      render: { tools, queue, token, clientDir: join(root, 'dist/client'), maxDurationMs: 60 * 60_000 },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const post = (captions: boolean) =>
      fetch(`${origin}/api/replays/${captionsId}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ speed: 1, captions }),
      });
    expect((await post(false)).status).toBe(202);
    expect((await post(true)).status).toBe(202);
    await Promise.all([queue.settled(captionsId, 1), queue.settled(captionsId, 1, { captions: true })]);
    const status = await (await fetch(`${origin}/api/replays/${captionsId}/render?captions=1`)).json();
    expect(status).toMatchObject({ jobId: `${captionsId}-1x-skip-cc`, status: 'done' });
    const plain = queue.outputFile(captionsId, 1);
    const captioned = queue.outputFile(captionsId, 1, { captions: true });
    expect(captioned).toMatch(/rendered-1x-skip-cc\.mp4$/);

    // Mid "Type a coupon code": the caption strip differs, the page above it does not.
    const { steps } = JSON.parse(await readFile(captionsSample, 'utf8')) as { steps: Array<{ at: number; label: string }> };
    const step = steps.findIndex((candidate) => candidate.label === 'Type a coupon code');
    const at = (steps[step]!.at + steps[step + 1]!.at) / 2000;
    const strip = meanDiff(grayStrip(plain, at, 'bottom'), grayStrip(captioned, at, 'bottom'));
    const page = meanDiff(grayStrip(plain, at, 'top'), grayStrip(captioned, at, 'top'));
    expect(strip).toBeGreaterThan(4);
    expect(page).toBeLessThan(1.5);
    // Caption entrances add a few captured frames, never fewer.
    expect(captured.true).toBeGreaterThan(captured.false ?? 0);

    const frame = join(dataDir, '..', 'captioned-frame.png');
    spawnSync(tools.ffmpegPath, ['-v', 'error', '-y', '-ss', String(at), '-i', captioned, '-frames:v', '1', frame]);
    if (process.env.RENDER_KEEP_CAPTIONS) await copyFile(frame, process.env.RENDER_KEEP_CAPTIONS);
    console.log(
      'captions render',
      JSON.stringify({ strip: Math.round(strip * 10) / 10, page: Math.round(page * 10) / 10, captured, frame }),
    );
  });
});

describe.skipIf(!ready || id !== 'demo-shop')('server-side render at the viewer speed with skip inactive', () => {
  it('renders 2× with idle gaps fast-forwarded, as long as the viewer would play it', { timeout: 300_000 }, async () => {
    const dataDir = join(await mkdtemp(join(tmpdir(), 'replay-kit-render-skip-')), 'data');
    await mkdir(join(dataDir, id), { recursive: true });
    await copyFile(sample, join(dataDir, id, 'replay.json'));
    const store = new ReplayStore(dataDir, join(dataDir, '..', 'sample'));
    const token = renderToken();
    let origin = '';
    const queue = new RenderQueue({
      dataDir,
      runner: createRenderer({ origin: () => origin, token, tools, fps: 15, pageUrl: (replay) => `${origin}/internal/render/${replay}` }),
    });
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'dist/client'),
      render: { tools, queue, token, clientDir: join(root, 'dist/client'), maxDurationMs: 60 * 60_000 },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const post = await fetch(`${origin}/api/replays/${id}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ speed: 2, skipInactive: true, captions: true }),
    });
    expect(post.status).toBe(202);
    await queue.settled(id, 2, { skipInactive: true, captions: true });
    const file = await fetch(`${origin}/api/replays/${id}/render/file?speed=2&captions=1`);
    expect(file.headers.get('content-disposition')).toBe(`attachment; filename="${id}-2x-captions.mp4"`);
    await file.arrayBuffer();

    const bundle = JSON.parse(await readFile(sample, 'utf8')) as {
      events: Array<{ type: number; timestamp: number }>;
    };
    const duration = bundle.events.at(-1)!.timestamp - bundle.events[0]!.timestamp;
    const gaps = idleGaps(bundle.events);
    expect(gaps.length).toBeGreaterThan(0);
    const expected = exportMap({ duration, speed: 2, gaps }).outputMs / 1000;
    const seconds = Number(probe(queue.outputFile(id, 2, { skipInactive: true, captions: true })).format?.duration);
    // The container adds about a frame (15 fps); clearly shorter than plain 2×.
    expect(Math.abs(seconds - expected)).toBeLessThan(0.2);
    expect(seconds).toBeLessThan(duration / 2000 - 0.5);
    console.log('skip render', JSON.stringify({ seconds, expected, plain2x: duration / 2000, gaps }));
  });
});
