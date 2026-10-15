import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { once } from 'node:events';

import type { RenderRunner, RenderTask } from './render-queue.ts';
import { NOOP_SPAN, type SpanHandle, startSpan, traceHeaders, withSpan } from './tracing.ts';

/**
 * Server-side video render: headless Chromium (playwright-core) loads the
 * internal render page (src/client/render/main.ts), steps it frame by frame
 * and pipes screenshots into ffmpeg (libx264, yuv420p, +faststart).
 *
 * Only frames the page marks dirty (an rrweb event landed, the cursor moved,
 * or the step caption changed) are captured; clean frames repeat the previous
 * image bytes. The video follows the viewer's options: `task.speed`,
 * `task.skipInactive` (idle gaps fast-forwarded) and `task.captions` (step
 * captions drawn in), and the replay's edit list (`task.edits`: trims and cuts,
 * src/shared/edits.ts).
 */

export interface RenderTools {
  available: boolean;
  /** Why rendering is off, for logs and the 503 body. */
  reason?: string;
  chromiumPath?: string;
  ffmpegPath: string;
}

export interface RendererOptions {
  /** Loopback origin of this server, e.g. http://127.0.0.1:3000 (a function when the port is known only after listen). */
  origin: string | (() => string);
  /** URL of the render page for a replay. */
  pageUrl: (id: string) => string;
  /** Sent as `x-render-token` on loopback requests only. */
  token: string;
  tools: RenderTools;
  fps?: number;
  /** JPEG quality for frames; 0 switches to PNG (lossless, slower). */
  jpegQuality?: number;
  crf?: number;
  /** Per-frame metrics, for logs and measurements. */
  onFinish?: (stats: RenderStats) => void;
}

export interface RenderStats {
  id: string;
  frames: number;
  captured: number;
  durationMs: number;
  replayMs: number;
  /** Time spent seeking the page vs capturing screenshots, ms. */
  seekMs: number;
  captureMs: number;
}

export const RENDER_TOKEN_HEADER = 'x-render-token';

export function renderToken() {
  return randomBytes(32).toString('base64url');
}

const SYSTEM_CHROMIUM = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

async function executable(path: string | undefined) {
  if (!path) return false;
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

function ffmpegWorks(path: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(path, ['-hide_banner', '-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Finds Chromium and ffmpeg without failing startup: CHROMIUM_PATH, then
 * Playwright's own browser, then common system installs; FFMPEG_PATH or `ffmpeg`.
 */
export async function detectRenderTools(env: NodeJS.ProcessEnv = process.env): Promise<RenderTools> {
  const ffmpegPath = env.FFMPEG_PATH || 'ffmpeg';
  if (env.RENDER_DISABLED === '1') return { available: false, reason: 'RENDER_DISABLED=1', ffmpegPath };
  let playwrightPath: string | undefined;
  try {
    const { chromium } = await import('playwright-core');
    playwrightPath = chromium.executablePath();
  } catch {
    return { available: false, reason: 'playwright-core is not installed', ffmpegPath };
  }
  const candidates = env.CHROMIUM_PATH ? [env.CHROMIUM_PATH] : [playwrightPath, ...SYSTEM_CHROMIUM];
  let chromiumPath: string | undefined;
  for (const candidate of candidates) {
    if (await executable(candidate)) {
      chromiumPath = candidate;
      break;
    }
  }
  if (!chromiumPath)
    return { available: false, reason: `Chromium not found (${env.CHROMIUM_PATH ? 'CHROMIUM_PATH' : 'set CHROMIUM_PATH'})`, ffmpegPath };
  if (!(await ffmpegWorks(ffmpegPath))) return { available: false, reason: `ffmpeg not found (${ffmpegPath})`, chromiumPath, ffmpegPath };
  return { available: true, chromiumPath, ffmpegPath };
}

/**
 * Chromium flags. The container runs as the unprivileged `node` user without
 * the user namespaces Chromium's sandbox needs (no SYS_ADMIN, default seccomp),
 * so the sandbox must be off there (CHROMIUM_NO_SANDBOX=1). The page only
 * loads our own render page plus the replay's recorded assets; scripts inside
 * the replayed document never run (rrweb rebuilds a static, script-free DOM).
 */
export function chromiumArgs(env: NodeJS.ProcessEnv = process.env) {
  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    // Never touch the OS keychain (a system Chrome on macOS would otherwise prompt for a password).
    '--use-mock-keychain',
    '--password-store=basic',
  ];
  if (env.CHROMIUM_NO_SANDBOX === '1') args.push('--no-sandbox');
  return args;
}

export function ffmpegArgs(options: { fps: number; crf: number; output: string; input?: 'jpeg' | 'png' }) {
  return [
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'image2pipe',
    // Explicit input codec: no probing, and the image's minimal ffmpeg build only has these two decoders.
    '-c:v',
    options.input === 'png' ? 'png' : 'mjpeg',
    '-framerate',
    String(options.fps),
    '-i',
    '-',
    // yuv420p needs even dimensions; JPEG frames are full range, players expect limited (tv) range.
    '-vf',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=out_range=tv,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(options.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    options.output,
  ];
}

interface RenderWindow {
  __render?: {
    ready: boolean;
    error?: string;
    duration: number;
    viewport: { width: number; height: number };
    plan(fps: number, speed: number, options?: { captions?: boolean; skipInactive?: boolean }): { count: number; dirty: number[] };
    show(index: number): Promise<void>;
  };
}

export function createRenderer(options: RendererOptions): RenderRunner {
  const fps = options.fps ?? 30;
  const quality = options.jpegQuality ?? 90;
  const crf = options.crf ?? 23;
  return async (task: RenderTask) => {
    if (!options.tools.available || !options.tools.chromiumPath) throw new Error('render unavailable');
    const started = Date.now();
    const { chromium } = await import('playwright-core');
    // Playwright launches Chromium with --no-sandbox unless chromiumSandbox is set; keep the sandbox unless told otherwise.
    const executablePath = options.tools.chromiumPath;
    const browser = await withSpan('render.browser_launch', {}, () =>
      chromium.launch({
        executablePath,
        headless: true,
        chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX !== '1',
        args: chromiumArgs(),
      }),
    );
    const abort = () => void browser.close().catch(() => undefined);
    task.signal.addEventListener('abort', abort, { once: true });
    let ffmpeg: ReturnType<typeof spawn> | undefined;
    // Spans that outlive one call (tracing.ts); NOOP_SPAN until started, and when tracing is off.
    let ffmpegSpan: SpanHandle = NOOP_SPAN;
    let framesSpan: SpanHandle = NOOP_SPAN;
    try {
      task.signal.throwIfAborted();
      const context = await browser.newContext({ deviceScaleFactor: 1, ignoreHTTPSErrors: true, reducedMotion: 'no-preference' });
      // The token rides only on requests back to this server, never to the replay's third-party asset origins.
      const origin = typeof options.origin === 'function' ? options.origin() : options.origin;
      // The job's trace context too (tracing.ts; empty when off), so the page's requests join the job's trace.
      const trace = traceHeaders();
      await context.route(`${origin}/**`, (route) =>
        route.continue({ headers: { ...route.request().headers(), ...trace, [RENDER_TOKEN_HEADER]: options.token } }),
      );
      const page = await context.newPage();
      await withSpan('render.page_load', { 'replay.id': task.id }, async () => {
        // An edited replay's page applies the edit list it is given the version of (and fails if it changed since).
        const pageUrl = new URL(options.pageUrl(task.id));
        if (task.edits) pageUrl.searchParams.set('edits', task.edits);
        await page.goto(pageUrl.toString(), { waitUntil: 'load', timeout: 60_000 });
        await page.waitForFunction(() => (window as RenderWindow).__render?.ready === true, undefined, { timeout: 120_000 });
      });
      const setup = await page.evaluate(() => {
        const api = (window as RenderWindow).__render;
        return { error: api?.error, viewport: api?.viewport, duration: api?.duration ?? 0 };
      });
      if (setup.error || !setup.viewport) throw new Error(`render page failed: ${setup.error ?? 'no viewport'}`);
      await page.setViewportSize(setup.viewport);
      const plan = await page.evaluate(([f, s, o]) => (window as RenderWindow).__render!.plan(f, s, o), [
        fps,
        task.speed,
        { captions: task.captions, skipInactive: task.skipInactive },
      ] as const);
      const dirty = new Set(plan.dirty);

      const child = spawn(options.tools.ffmpegPath, ffmpegArgs({ fps, crf, output: task.output, input: quality > 0 ? 'jpeg' : 'png' }), {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      ffmpeg = child;
      // ffmpeg encodes while frames are captured: its span runs from spawn to exit, alongside render.frames.
      const encodeSpan = startSpan('render.ffmpeg', { 'render.fps': fps, 'render.crf': crf });
      ffmpegSpan = encodeSpan;
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      // Every child/pipe error is captured, never left unhandled: a killed ffmpeg (cancel, timeout)
      // makes the pending stdin write fail with EPIPE, which would otherwise crash the server.
      let pipeError: Error | undefined;
      const exited = new Promise<number | null>((resolve) => {
        child.once('exit', (code) => {
          encodeSpan.setAttributes({ 'process.exit.code': code ?? -1 });
          encodeSpan.end(code === 0 ? undefined : { code: 'FFMPEG_EXIT' });
          resolve(code);
        });
        child.once('error', (error) => {
          pipeError ??= error;
          encodeSpan.end(error);
          resolve(null);
        });
      });
      const stdin = child.stdin!;
      stdin.on('error', (error) => {
        pipeError ??= error;
      });
      let frame: Buffer | undefined;
      let seekMs = 0;
      let captureMs = 0;
      const cdp = await page.context().newCDPSession(page);
      framesSpan = startSpan('render.frames', { 'render.frame_count': plan.count, 'render.captured_frames': dirty.size });
      for (let index = 0; index < plan.count; index++) {
        task.signal.throwIfAborted();
        if (!frame || dirty.has(index)) {
          const seekStart = performance.now();
          await page.evaluate((i) => (window as RenderWindow).__render!.show(i), index);
          const captureStart = performance.now();
          // CDP directly: page.screenshot() adds font/animation/caret waits we do not need per frame.
          const shot = (await cdp.send('Page.captureScreenshot', {
            format: quality > 0 ? 'jpeg' : 'png',
            ...(quality > 0 ? { quality } : {}),
            optimizeForSpeed: true,
            captureBeyondViewport: false,
            // Without a clip, headless Chrome may capture its window size rather than the emulated viewport.
            clip: { x: 0, y: 0, width: setup.viewport.width, height: setup.viewport.height, scale: 1 },
          })) as { data: string };
          frame = Buffer.from(shot.data, 'base64');
          seekMs += captureStart - seekStart;
          captureMs += performance.now() - captureStart;
        }
        if (pipeError) throw new Error(`ffmpeg failed: ${pipeError.message} ${stderr.trim().split('\n').at(-1) ?? ''}`.trim());
        if (!stdin.write(frame)) await Promise.race([once(stdin, 'drain').catch(() => undefined), exited]);
        task.onProgress((index + 1) / plan.count);
      }
      framesSpan.setAttributes({ 'render.seek_ms': Math.round(seekMs), 'render.capture_ms': Math.round(captureMs) });
      framesSpan.end();
      stdin.end();
      const code = await exited;
      if (pipeError) throw new Error(`ffmpeg failed: ${pipeError.message}`);
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`);
      options.onFinish?.({
        id: task.id,
        frames: plan.count,
        captured: dirty.size,
        durationMs: Date.now() - started,
        replayMs: setup.duration,
        seekMs: Math.round(seekMs),
        captureMs: Math.round(captureMs),
      });
    } catch (error) {
      framesSpan.end(error);
      ffmpeg?.kill('SIGKILL');
      ffmpegSpan.end(error);
      throw task.signal.aborted ? task.signal.reason : error;
    } finally {
      task.signal.removeEventListener('abort', abort);
      await browser.close().catch(() => undefined);
    }
  };
}
