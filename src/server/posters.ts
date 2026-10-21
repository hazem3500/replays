import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { send } from './app.ts';
import { PREVIEW_SPEED } from '../client/render/frames.ts';
import { chromiumArgs, ffmpegArgs, RENDER_TOKEN_HEADER, type RenderTools } from './renderer.ts';
import type { PosterMoment } from '../shared/purposes.ts';
import { serveObject } from './serve-object.ts';
import { ObjectExistsError, type ObjectStorage, readJson } from './storage/index.ts';
import type { ReplayStore } from './store.ts';
import { captureLink, traceHeaders, type TraceLink, withSpan } from './tracing.ts';

/**
 * List media for the replay index, made by headless Chromium on the internal render
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
 * then stored (src/server/storage/) as <id>/poster.v2.jpg, open.v1.jpg and preview.v2.mp4, pruned with
 * the replay. List requests never wait for them.
 */

export const POSTER_WIDTH = 480;
export const POSTER_QUALITY = 70;
export const PREVIEW_FPS = 15;
/** Longest preview (output time): 15 s at 3× is the first 45 s of the replay, idle gaps squeezed. */
export const PREVIEW_MAX_OUTPUT_MS = 15_000;
/** x264 CRF for previews: ~100–250 KB for 6 s at 480 px. */
export const PREVIEW_CRF = 32;
/** A failed job is not retried for this long (the client keeps the poster or placeholder meanwhile). */
const RETRY_FAILED_MS = 10 * 60_000;

export type MediaKind = 'poster' | 'open' | 'preview';

export interface PosterTask {
  id: string;
  /** Where the poster is taken (the replay's purpose decides; absent: the default moment). Posters only. */
  moment?: PosterMoment;
  /** Write the file here, a local temporary path (the queue stores it, and an optional `<output>.json` sidecar). */
  output: string;
  signal: AbortSignal;
}

export type PosterRunner = (task: PosterTask) => Promise<void>;

export type PosterState = 'ready' | 'pending' | 'failed' | 'full' | 'off';

export interface PosterQueueOptions {
  /** Where finished media are stored (ReplayStore.storage). */
  storage: ObjectStorage;
  /** The finished poster's key (ReplayStore.posterKey). */
  key: (id: string) => string;
  runner: PosterRunner;
  /** The poster moment for a replay (from its purpose); absent or undefined means the default. */
  moment?: (id: string) => Promise<PosterMoment | undefined>;
  /** Hover previews; absent (no ffmpeg) means previews are off. */
  preview?: { key: (id: string) => string; runner: PosterRunner };
  /** Opening stills (ReplayStore.openStillKey); the poster runner also leaves one at `<output>.open.jpg`. */
  open?: { key: (id: string) => string; runner: PosterRunner };
  /** Where jobs write before the result is stored; the OS temporary directory by default. */
  tempDir?: string;
  /** True while something more important (a video render) is using the browser; jobs wait. */
  busy?: () => boolean;
  maxQueued?: number;
  timeoutMs?: number;
  /** Poll interval while `busy()`. */
  waitMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

interface Job {
  kind: MediaKind;
  id: string;
  /** Wall-clock enqueue time and the requesting span, for the job's own trace (tracing.ts). */
  queuedAtMs?: number;
  link?: TraceLink | undefined;
}

const key = (kind: MediaKind, id: string) => `${kind}:${id}`;

export class PosterQueue {
  private readonly options: Required<Omit<PosterQueueOptions, 'busy' | 'preview' | 'open' | 'tempDir' | 'moment'>> &
    Pick<PosterQueueOptions, 'preview' | 'open' | 'tempDir' | 'moment'> & { busy: () => boolean };
  /** Posters first: they are what the list shows; then opening stills (opening a replay); previews only play on hover. */
  private readonly waiting: Record<MediaKind, Job[]> = { poster: [], open: [], preview: [] };
  private readonly pending = new Set<string>();
  private readonly failed = new Map<string, number>();
  private readonly settledBy = new Map<string, Promise<void>>();
  private readonly resolvers = new Map<string, () => void>();
  private running = false;
  /** Milliseconds each finished job took, newest last (logs, measurements). */
  readonly timings: Array<{ kind: MediaKind; id: string; ms: number; bytes: number }> = [];

  constructor(options: PosterQueueOptions) {
    this.options = {
      busy: () => false,
      maxQueued: 200,
      timeoutMs: 120_000,
      waitMs: 2000,
      now: Date.now,
      log: () => undefined,
      ...options,
    };
  }

  /** Whether `kind` can be made here at all (previews need ffmpeg). */
  supports(kind: MediaKind) {
    return kind === 'poster' || Boolean(kind === 'open' ? this.options.open : this.options.preview);
  }

  key(id: string, kind: MediaKind = 'poster') {
    return kind === 'poster' ? this.options.key(id) : kind === 'open' ? this.options.open!.key(id) : this.options.preview!.key(id);
  }

  private get queued() {
    return this.waiting.poster.length + this.waiting.open.length + this.waiting.preview.length;
  }

  async exists(id: string, kind: MediaKind = 'poster') {
    return Boolean(await this.options.storage.stat(this.key(id, kind)));
  }

  /** The file's state, queueing it when it is neither stored, queued nor recently failed. */
  async request(id: string, kind: MediaKind = 'poster'): Promise<PosterState> {
    if (!this.supports(kind)) return 'off';
    const name = key(kind, id);
    if (this.pending.has(name)) return 'pending';
    if (await this.exists(id, kind)) return 'ready';
    const failedAt = this.failed.get(name);
    if (failedAt !== undefined && this.options.now() - failedAt < RETRY_FAILED_MS) return 'failed';
    if (this.queued >= this.options.maxQueued) return 'full';
    this.failed.delete(name);
    this.pending.add(name);
    this.waiting[kind].push({ kind, id, queuedAtMs: Date.now(), link: captureLink() });
    this.settledBy.set(name, new Promise<void>((resolve) => this.resolvers.set(name, resolve)));
    void this.pump();
    return 'pending';
  }

  /** Resolves when `id`'s job of `kind` settles (tests, warm-up scripts). */
  async settled(id: string, kind: MediaKind = 'poster') {
    await this.settledBy.get(key(kind, id));
  }

  get size() {
    return { running: this.running ? 1 : 0, queued: this.queued };
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queued > 0) {
        while (this.options.busy()) await new Promise((resolve) => setTimeout(resolve, this.options.waitMs));
        const job = (this.waiting.poster.shift() ?? this.waiting.open.shift() ?? this.waiting.preview.shift())!;
        const name = key(job.kind, job.id);
        await this.run(job);
        this.pending.delete(name);
        this.resolvers.get(name)?.();
        this.resolvers.delete(name);
        this.settledBy.delete(name);
      }
    } finally {
      this.running = false;
    }
  }

  /** Drops a waiting job that another one has already done, settling anyone waiting on it. */
  private dequeue(kind: MediaKind, id: string) {
    const index = this.waiting[kind].findIndex((job) => job.id === id);
    if (index < 0) return;
    this.waiting[kind].splice(index, 1);
    const name = key(kind, id);
    this.pending.delete(name);
    this.resolvers.get(name)?.();
    this.resolvers.delete(name);
    this.settledBy.delete(name);
  }

  /** One poster, opening still or preview in its own trace (`media.<kind>`), linked to the request that queued it. */
  private run(job: Job) {
    const attributes = {
      'replay.id': job.id,
      'media.kind': job.kind,
      'media.queue_wait_ms': job.queuedAtMs === undefined ? undefined : Date.now() - job.queuedAtMs,
    };
    return withSpan(
      `media.${job.kind}`,
      attributes,
      async (span) => {
        const failure = await this.execute(job);
        if (failure !== undefined) span.setError(failure);
      },
      { root: true, links: [job.link] },
    );
  }

  /** Makes and stores the file; returns why it failed (undefined when it did not). */
  private async execute({ kind, id }: Job): Promise<unknown> {
    const output = this.key(id, kind);
    const { storage } = this.options;
    const directory = await mkdtemp(join(this.options.tempDir ?? tmpdir(), `replays-${kind}-`));
    const temporary = join(directory, `${kind}${extname(output)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${kind} timed out`)), this.options.timeoutMs);
    const started = this.options.now();
    try {
      const runner = kind === 'poster' ? this.options.runner : kind === 'open' ? this.options.open!.runner : this.options.preview!.runner;
      const moment = kind === 'poster' ? await this.options.moment?.(id).catch(() => undefined) : undefined;
      await runner({ id, output: temporary, signal: controller.signal, ...(moment ? { moment } : {}) });
      controller.signal.throwIfAborted();
      // The sidecar first: whoever sees the media also sees what it covers.
      if (await stat(`${temporary}.json`).catch(() => undefined))
        await storage.upload(`${output}.json`, `${temporary}.json`, { contentType: 'application/json; charset=utf-8' });
      const stored = await storage.upload(output, temporary, { contentType: MEDIA[kind].type });
      // The poster job's opening still (shot on the way): stored unless there is one, and a queued
      // opening-still job for this replay is then done too.
      if (kind === 'poster' && this.options.open && (await stat(`${temporary}.open.jpg`).catch(() => undefined))) {
        const kept = await storage
          .upload(this.options.open.key(id), `${temporary}.open.jpg`, { createOnly: true, contentType: MEDIA.open.type })
          .then(
            () => true,
            (error: unknown) => {
              if (!(error instanceof ObjectExistsError)) throw error;
              return false;
            },
          );
        if (kept) this.dequeue('open', id);
      }
      const ms = this.options.now() - started;
      const bytes = stored.size;
      this.timings.push({ kind, id, ms, bytes });
      if (this.timings.length > 200) this.timings.shift();
      this.options.log(`${kind} ${id}: done in ${(ms / 1000).toFixed(1)} s (${Math.round(bytes / 1024)} KB)`);
      return undefined;
    } catch (error) {
      this.failed.set(key(kind, id), this.options.now());
      this.options.log(
        `${kind} ${id}: failed: ${String(error instanceof Error ? error.message : error)
          .split('\n')[0]
          ?.slice(0, 300)}`,
      );
      return error;
    } finally {
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  }
}

interface RenderWindow {
  __render?: {
    ready: boolean;
    error?: string;
    viewport: { width: number; height: number };
    poster(moment?: PosterMoment): Promise<number>;
    previewPlan(fps: number, maxOutputMs: number): { times: number[]; dirty: number[]; capped: boolean; coveredMs: number };
    showAt(time: number): Promise<void>;
  };
}

export interface PosterRendererOptions {
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
        // Hosts that block unprivileged user namespaces (Ubuntu 23.10+, GitHub's ubuntu-24.04 runners, default
        // container seccomp) cannot start Chromium's sandbox; every list-media job would fail with a long launch
        // log whose first line says little. Say what to do instead.
        const message = error instanceof Error ? error.message : String(error);
        if (sandbox && /sandbox|namespace|zygote/i.test(message))
          throw new Error(
            `Chromium's sandbox could not start here (set CHROMIUM_NO_SANDBOX=1 where user namespaces are blocked): ${message}`,
          );
        throw error;
      });
  };

  /** Opens the render page for `task.id` at its recorded viewport and hands it to `work`. */
  const withPage = async (task: PosterTask, work: (page: Page, cdp: CDPSession, shoot: () => Promise<Buffer>) => Promise<void>) => {
    if (!options.tools.chromiumPath) throw new Error('list media unavailable');
    clearTimeout(idle);
    browser ??= launch();
    const current = browser;
    const shared = await current.catch((error: unknown) => {
      browser = undefined;
      throw error;
    });
    const context = await shared.newContext({ deviceScaleFactor: 1, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
    const abort = () => void context.close().catch(() => undefined);
    task.signal.addEventListener('abort', abort, { once: true });
    try {
      const origin = typeof options.origin === 'function' ? options.origin() : options.origin;
      // The job's trace context too (tracing.ts; empty when off), so the page's requests join the job's trace.
      const trace = traceHeaders();
      await context.route(`${origin}/**`, (route) =>
        route.continue({ headers: { ...route.request().headers(), ...trace, [RENDER_TOKEN_HEADER]: options.token } }),
      );
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
      // Scaled down by the compositor: frames come out ~480 px wide, no resize pass needed.
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
      // The page loads showing t = 0: the opening still comes first, for the price of one screenshot.
      await writeFile(`${task.output}.open.jpg`, await shoot(), { mode: 0o640 });
      task.signal.throwIfAborted();
      await page.evaluate((moment) => (window as RenderWindow).__render!.poster(moment), task.moment);
      task.signal.throwIfAborted();
      await writeFile(task.output, await shoot(), { mode: 0o640 });
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
      // Every pipe error is captured: a killed ffmpeg makes the pending write fail with EPIPE.
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

  /** The opening still on its own (replays whose poster predates it): the page as it loads, at t = 0. */
  const open: PosterRunner = (task) =>
    withPage(task, async (_page, _cdp, shoot) => {
      await writeFile(task.output, await shoot(), { mode: 0o640 });
    });

  return { poster, open, preview };
}

/** H.264 at PREVIEW_FPS, small (CRF PREVIEW_CRF, ≤ 160 kbit/s), silent, +faststart so it plays while downloading. */
export function previewFfmpegArgs(output: string) {
  const args = ffmpegArgs({ fps: PREVIEW_FPS, crf: PREVIEW_CRF, output, input: 'jpeg' });
  // No audio track at all, and short GOPs so a looping clip seeks cheaply.
  // A bitrate ceiling keeps busy pages (constant DOM churn) near the ~300 KB budget for 15 s.
  args.splice(args.indexOf('-movflags'), 0, '-an', '-g', String(PREVIEW_FPS * 2), '-maxrate', '160k', '-bufsize', '320k');
  return args;
}

const JSON_TYPE = 'application/json; charset=utf-8';

const MEDIA: Record<MediaKind, { type: string; key: (store: ReplayStore, id: string) => string; off: string }> = {
  poster: { type: 'image/jpeg', key: (store, id) => store.posterKey(id), off: 'posters unavailable' },
  open: { type: 'image/jpeg', key: (store, id) => store.openStillKey(id), off: 'opening stills unavailable' },
  preview: { type: 'video/mp4', key: (store, id) => store.previewKey(id), off: 'previews unavailable' },
};

/**
 * `GET|HEAD /api/replays/<id>/poster`, `/open` (the opening still) and `/preview` (behind the same auth as the rest of the app):
 * 200 JPEG / MP4 (weak ETag, cached a week; the MP4 supports byte ranges) once stored; 202 + Retry-After
 * while it is generated; 404 for an unknown replay or a job that failed; 503 without Retry-After when the
 * kind is off here (posters: no Chromium or RENDER_DISABLED=1; previews: also no ffmpeg), 503 + Retry-After
 * when the queue is full. The client keeps the poster (or placeholder) for anything but 200.
 */
export async function handlePosterApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: { store: ReplayStore; posters?: PosterQueue | undefined },
) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})\/(poster|open|preview)$/.exec(path);
  if (!match) return false;
  const id = match[1]!;
  const kind = match[2] as MediaKind;
  const media = MEDIA[kind];
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, JSON.stringify({ error: 'method not allowed' }), JSON_TYPE);
    return true;
  }
  if (!(await options.store.locate(id))) {
    send(response, 404, JSON.stringify({ error: 'replay not found' }), JSON_TYPE);
    return true;
  }
  const cache = 'private, max-age=604800';
  const serve = async () => {
    const objectKey = media.key(options.store, id);
    const info = await options.store.storage.stat(objectKey);
    if (!info) return false;
    // The preview's sidecar rides along as headers, so the client's HEAD can label a cut-short clip.
    const meta =
      kind === 'preview'
        ? await readJson<{ capped?: boolean; coveredMs?: number; speed?: number }>(options.store.storage, `${objectKey}.json`).catch(
            () => undefined,
          )
        : undefined;
    const headers: Record<string, string> = meta
      ? {
          'x-preview-speed': String(meta.speed ?? PREVIEW_SPEED),
          'x-preview-covers-ms': String(Math.round(meta.coveredMs ?? 0)),
          'x-preview-capped': meta.capped ? '1' : '0',
        }
      : {};
    return serveObject(request, response, options.store.storage, objectKey, cache, {
      contentType: media.type,
      etag: true,
      ranges: kind === 'preview',
      headers,
      info,
    });
  };
  if (await serve()) {
    // A listed poster means someone is looking at this replay: warm its opening still and hover preview.
    if (kind === 'poster') for (const next of ['open', 'preview'] as const) void options.posters?.request(id, next).catch(() => undefined);
    return true;
  }
  const state = options.posters ? await options.posters.request(id, kind) : 'off';
  if (state === 'off') {
    send(response, 503, JSON.stringify({ error: media.off }), JSON_TYPE);
    return true;
  }
  if (state === 'ready' && (await serve())) return true;
  if (state === 'failed') {
    send(response, 404, JSON.stringify({ error: `no ${kind} for this replay` }), JSON_TYPE);
    return true;
  }
  response.writeHead(state === 'full' ? 503 : 202, {
    'content-type': JSON_TYPE,
    'cache-control': 'no-store',
    'retry-after': state === 'full' ? '30' : '2',
  });
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: state === 'full' ? 'busy' : 'pending' }));
  return true;
}
