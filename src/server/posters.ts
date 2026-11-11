import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';

import { PREVIEW_SPEED } from '../client/render/frames.ts';
import { isThumbHash } from '../shared/thumbhash.ts';
import { guardRenderRequests, type RenderAssetPolicy } from './media/browser-network.ts';
import type { MediaKind, PosterRunner, PosterTask } from './media/poster-queue.ts';
import { chromiumArgs, ffmpegArgs, RENDER_TOKEN_HEADER, type RenderTools } from './renderer.ts';
import type { PosterChoice } from './store.ts';
import { traceHeaders } from './tracing.ts';

/* why: list media for the replay index are made by headless Chromium on the internal render
 * page (src/client/render/main.ts):
 * - a poster: one small JPEG, `__render.poster()` (first full snapshot + 1 s);
 * - an opening still: the same size, at t = 0 as the viewer first paints it (the page is there on load, so
 *   the poster job shoots it first for free; replays from before it are made on their own, lazily). The
 *   page transition from the index lands on it, so the frame never changes content when rrweb takes over;
 * - a preview: a short silent MP4 of the replay at 3× with idle gaps squeezed, at most
 *   15 s long (`__render.previewPlan()`, frames.ts), for hover playback. Its
 *   `<file>.json` sidecar says whether it was cut short and how much it covers.
 * One job at a time (posters before previews), only while no video export is
 * running, so list media never slow an export. Made in a local temporary directory,
 * then stored (src/server/storage/) as <id>/poster.v2.jpg, open.v2.jpg and preview.v2.mp4, pruned with
 * the replay. List requests never wait for them. A poster taken at a non-default moment (a purpose's `poster`, a
 * plugin's `posterAt`) is stored as poster.v2-<moment>.jpg (ReplayStore.posterKey), so a changed choice remakes it.
 */

export const POSTER_WIDTH = 480;
export const POSTER_QUALITY = 70;
export const PREVIEW_FPS = 15;
/** Longest preview (output time): 15 s at 3× is the first 45 s of the replay, idle gaps squeezed. */
export const PREVIEW_MAX_OUTPUT_MS = 15_000;
/** x264 CRF for previews: ~100–250 KB for 6 s at 480 px. */
export const PREVIEW_CRF = 32;
interface RenderWindow {
  __render?: {
    ready: boolean;
    error?: string;
    viewport: { width: number; height: number };
    poster(moment?: PosterChoice): Promise<number>;
    previewPlan(fps: number, maxOutputMs: number): { times: number[]; dirty: number[]; capped: boolean; coveredMs: number };
    showAt(time: number): Promise<void>;
    thumbhash?(jpeg: string): Promise<string>;
  };
}

export interface PosterRendererOptions {
  assetPolicy?: RenderAssetPolicy;
  origin: string | (() => string);
  pageUrl: (id: string) => string;
  token: string;
  tools: RenderTools;
  width?: number;
  quality?: number;
  /** Close the shared browser after this long without work. */
  idleMs?: number;
}

type Page = import('playwright-core').Page;
type CDPSession = import('playwright-core').CDPSession;

/**
 * Poster and preview runners sharing one headless Chromium, launched on the first job and
 * closed after `idleMs` without work, so a backlog (an index of old replays) costs one launch.
 */
export function createMediaRenderer(options: PosterRendererOptions): Record<MediaKind, PosterRunner> {
  const width = options.width ?? POSTER_WIDTH;
  const quality = options.quality ?? POSTER_QUALITY;
  const idleMs = options.idleMs ?? 20_000;
  let browser: Promise<import('playwright-core').Browser> | undefined;
  let idle: NodeJS.Timeout | undefined;

  const launch = async () => {
    const { chromium } = await import('playwright-core');
    const sandbox = process.env.CHROMIUM_NO_SANDBOX !== '1';
    return chromium
      .launch({ executablePath: options.tools.chromiumPath!, headless: true, chromiumSandbox: sandbox, args: chromiumArgs() })
      .catch((error: unknown) => {
        /* why: hosts that block unprivileged user namespaces (Ubuntu 23.10+, GitHub's ubuntu-24.04 runners, default
           container seccomp) cannot start Chromium's sandbox; every job would fail with a long launch log whose first
           line says little, so the error says what to do instead. */
        const message = error instanceof Error ? error.message : String(error);
        if (sandbox && /sandbox|namespace|zygote/i.test(message))
          throw new Error(
            `Chromium's sandbox could not start here (set CHROMIUM_NO_SANDBOX=1 where user namespaces are blocked): ${message}`,
          );
        throw error;
      });
  };

  const withPage = async (task: PosterTask, work: (page: Page, cdp: CDPSession, shoot: () => Promise<Buffer>) => Promise<void>) => {
    if (!options.tools.chromiumPath) throw new Error('list media unavailable');
    clearTimeout(idle);
    browser ??= launch();
    const current = browser;
    const shared = await current.catch((error: unknown) => {
      browser = undefined;
      throw error;
    });
    const context = await shared.newContext({
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    const abort = () => void context.close().catch(() => undefined);
    task.signal.addEventListener('abort', abort, { once: true });
    try {
      const origin = typeof options.origin === 'function' ? options.origin() : options.origin;
      // why: the job's trace context rides along (empty when off), so the page's requests join the job's trace.
      const trace = traceHeaders();
      await guardRenderRequests(context, origin, { ...trace, [RENDER_TOKEN_HEADER]: options.token }, options.assetPolicy);
      const page = await context.newPage();
      await page.goto(options.pageUrl(task.id), { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => (window as RenderWindow).__render?.ready === true, undefined, { timeout: 30_000 });
      const setup = await page.evaluate(() => ({
        error: (window as RenderWindow).__render?.error,
        viewport: (window as RenderWindow).__render?.viewport,
      }));
      if (setup.error || !setup.viewport?.width) throw new Error(`render page failed: ${setup.error ?? 'no viewport'}`);
      const viewport = setup.viewport;
      await page.setViewportSize(viewport);
      const cdp = await context.newCDPSession(page);
      // why: the compositor scales frames down to ~480 px wide, so no resize pass is needed.
      const shoot = async () => {
        const shot = (await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality,
          optimizeForSpeed: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: Math.min(1, width / viewport.width) },
        })) as { data: string };
        return Buffer.from(shot.data, 'base64');
      };
      await work(page, cdp, shoot);
    } finally {
      task.signal.removeEventListener('abort', abort);
      await context.close().catch(() => undefined);
      if (browser === current) {
        idle = setTimeout(() => {
          if (browser !== current) return;
          browser = undefined;
          void shared.close().catch(() => undefined);
        }, idleMs);
        idle.unref();
      }
    }
  };

  const poster: PosterRunner = (task) =>
    withPage(task, async (page, _cdp, shoot) => {
      // why: the page loads showing t = 0, so the opening still costs one screenshot when taken first.
      await writeFile(`${task.output}.open.jpg`, await shoot(), { mode: 0o640 });
      task.signal.throwIfAborted();
      await page.evaluate((moment) => (window as RenderWindow).__render!.poster(moment), task.moment);
      task.signal.throwIfAborted();
      const shot = await shoot();
      await writeFile(task.output, shot, { mode: 0o640 });
      // why: a poster without its ThumbHash is still a poster; the index then keeps the plain placeholder.
      const thumbhash = await page
        .evaluate((jpeg) => (window as RenderWindow).__render?.thumbhash?.(jpeg), shot.toString('base64'))
        .catch(() => undefined);
      if (isThumbHash(thumbhash)) await writeFile(`${task.output}.json`, `${JSON.stringify({ thumbhash })}\n`, { mode: 0o640 });
    });

  const preview: PosterRunner = (task) =>
    withPage(task, async (page, _cdp, shoot) => {
      const plan = await page.evaluate(([fps, max]) => (window as RenderWindow).__render!.previewPlan(fps, max), [
        PREVIEW_FPS,
        PREVIEW_MAX_OUTPUT_MS,
      ] as const);
      await writeFile(
        `${task.output}.json`,
        `${JSON.stringify({ capped: plan.capped, coveredMs: plan.coveredMs, speed: PREVIEW_SPEED })}\n`,
        {
          mode: 0o640,
        },
      );
      const dirty = new Set(plan.dirty);
      const child = spawn(options.tools.ffmpegPath, previewFfmpegArgs(task.output), { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      // why: a killed ffmpeg makes the pending write fail with EPIPE, so every pipe error is captured.
      let pipeError: Error | undefined;
      const exited = new Promise<number | null>((resolve) => {
        child.once('exit', resolve);
        child.once('error', (error) => {
          pipeError ??= error;
          resolve(null);
        });
      });
      child.stdin!.on('error', (error) => {
        pipeError ??= error;
      });
      const kill = () => child.kill('SIGKILL');
      task.signal.addEventListener('abort', kill, { once: true });
      try {
        let frame: Buffer | undefined;
        for (const [index, time] of plan.times.entries()) {
          task.signal.throwIfAborted();
          if (!frame || dirty.has(index)) {
            await page.evaluate((at) => (window as RenderWindow).__render!.showAt(at), time);
            frame = await shoot();
          }
          if (pipeError) throw pipeError;
          if (!child.stdin!.write(frame)) await Promise.race([once(child.stdin!, 'drain').catch(() => undefined), exited]);
        }
        child.stdin!.end();
        const code = await exited;
        if (pipeError) throw pipeError;
        if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`);
      } catch (error) {
        kill();
        throw error;
      } finally {
        task.signal.removeEventListener('abort', kill);
      }
    });

  // why: replays whose poster predates opening stills get one on its own: the page as it loads, at t = 0.
  const open: PosterRunner = (task) =>
    withPage(task, async (_page, _cdp, shoot) => {
      await writeFile(task.output, await shoot(), { mode: 0o640 });
    });

  return { poster, open, preview };
}

/** H.264 at PREVIEW_FPS, small (CRF PREVIEW_CRF, ≤ 160 kbit/s), silent, +faststart so it plays while downloading. */
export function previewFfmpegArgs(output: string) {
  const args = ffmpegArgs({ fps: PREVIEW_FPS, crf: PREVIEW_CRF, output, input: 'jpeg' });
  /* why: no audio track, short GOPs so a looping clip seeks cheaply, and a bitrate ceiling that keeps busy pages
     (constant DOM churn) near the ~300 KB budget for 15 s. */
  args.splice(args.indexOf('-movflags'), 0, '-an', '-g', String(PREVIEW_FPS * 2), '-maxrate', '160k', '-bufsize', '320k');
  return args;
}
