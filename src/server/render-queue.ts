import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RENDER_SPEEDS, type RenderSpeed } from '../client/render/frames.ts';
import type { RenderedFile, RenderJob } from '../plugin/types.ts';
import type { Identity } from './auth/types.ts';
import { FsStorage, type ObjectStorage, readJson } from './storage/index.ts';
import { captureLink, startSpan, type TraceLink, withSpan } from './tracing.ts';

/**
 * In-process queue for server-side video renders. One job per replay and
 * variant (speed, skip inactive, captions): POSTing the same variant returns
 * the running job or the cached MP4. Jobs run `concurrency` at a time; the
 * queue is bounded; each job has a timeout. Job state is mirrored to the
 * store (src/server/storage/) as <id>/render-<variant>.json so a job that was queued or rendering
 * when the process died reads as failed (and retryable) after a restart.
 * The MP4 is rendered into a local temporary directory, then stored atomically as
 * <id>/rendered-<variant>.mp4, under the replay's prefix, so retention prunes it with the replay. `<variant>` is
 * `<speed>x[-skip][-cc][-e<edits>]` (renderVariant); `<edits>` is the edit list's content version
 * (src/shared/edits.ts editsVersion), so an edited replay is never served a video rendered before (or without) its edits.
 * Skip inactive defaults to on (as in the player), but the file names mark it explicitly, so files from before
 * it existed (`rendered-1x.mp4`, rendered without skipping) still name exactly what they hold: the
 * `skipInactive: false` variant.
 */

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'failed';
export type RenderSpeedOption = RenderSpeed;
export const RENDER_SPEED_OPTIONS: readonly RenderSpeedOption[] = RENDER_SPEEDS;

/** Everything about a render besides its replay and speed; absent means off. */
export interface RenderOptions {
  /** Draw the viewer's step captions into the frames. */
  captions?: boolean;
  /** Fast-forward idle gaps as the viewer's "skip inactive" does; absent means on, like the player. */
  skipInactive?: boolean;
  /** The edit list's version (editsVersion) the video applies; '' or absent renders the replay as recorded. */
  edits?: string;
}

export interface RenderJobView {
  jobId: string;
  status: RenderStatus;
  /** 0–1. */
  progress: number;
  etaMs?: number;
  error?: string;
  /** Bytes of the finished MP4. */
  size?: number;
}

export interface RenderTask {
  id: string;
  speed: RenderSpeedOption;
  /** Draw the viewer's step captions into the frames. */
  captions: boolean;
  /** Fast-forward idle gaps as the viewer does. */
  skipInactive: boolean;
  /** The edit list version to apply (the render page checks it is still the stored one); '' for none. */
  edits: string;
  /** Write the MP4 here, a local temporary path (the queue stores it). */
  output: string;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}

export type RenderRunner = (task: RenderTask) => Promise<void>;

export interface RenderQueueOptions {
  /** Where MP4s and job state are stored (ReplayStore.storage); or `dataDir` for a directory on disk. */
  storage?: ObjectStorage;
  dataDir?: string;
  /** Where renders are written before they are stored; the OS temporary directory by default. */
  tempDir?: string;
  runner: RenderRunner;
  concurrency?: number;
  maxQueued?: number;
  timeoutMs?: number;
  now?: () => number;
  /** One line per job state change (queued, rendering, done, failed, cancelled). */
  log?: (line: string) => void;
  /**
   * Called once the MP4 is stored and the job reads as done, before its temporary file is removed (the plugins'
   * `afterRender`, render-hooks.ts). Its errors are logged; the job stays done.
   */
  afterRender?: (job: RenderJob, file: RenderedFile) => void | Promise<void>;
}

export class RenderQueueFullError extends Error {
  readonly status = 429;
  constructor() {
    super('the render queue is full; try again in a few minutes');
  }
}

interface Job {
  id: string;
  speed: RenderSpeedOption;
  options: Required<RenderOptions>;
  status: RenderStatus;
  progress: number;
  startedAt?: number;
  error?: string;
  controller: AbortController;
  done: Promise<void>;
  resolve: () => void;
  /** Wall-clock enqueue time and the requesting span, for the job's own trace (tracing.ts). */
  queuedAtMs: number;
  link?: TraceLink | undefined;
  /** Who asked for it first (the `afterRender` hooks see them). */
  identity?: Identity | undefined;
}

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * `<speed>x`, `-skip` with skip inactive (the default), `-cc` with step captions: names the job, its MP4
 * and its state file. Without `-skip` it is the full-idle-time render, as every render before skip was.
 */
export const renderVariant = (speed: RenderSpeedOption, options: RenderOptions = {}) =>
  `${speed}x${options.skipInactive !== false ? '-skip' : ''}${options.captions ? '-cc' : ''}${options.edits ? `-e${options.edits}` : ''}`;

/** An edit list version as names carry it (editsVersion: base 36). */
export const EDITS_VERSION_PATTERN = /^[a-z0-9]{1,16}$/;

/** The inverse of renderVariant for a `render-<variant>.json` state file name, or undefined. */
export function parseStateFile(name: string): { speed: RenderSpeedOption; options: Required<RenderOptions> } | undefined {
  const match = /^render-([\d.]+)x(-skip)?(-cc)?(?:-e([a-z0-9]{1,16}))?\.json$/.exec(name);
  const speed = Number(match?.[1]) as RenderSpeedOption;
  if (!match || !RENDER_SPEED_OPTIONS.includes(speed)) return undefined;
  return { speed, options: { skipInactive: Boolean(match[2]), captions: Boolean(match[3]), edits: match[4] ?? '' } };
}

const normalize = (options: RenderOptions): Required<RenderOptions> => ({
  captions: Boolean(options.captions),
  skipInactive: options.skipInactive !== false,
  edits: options.edits ?? '',
});

export const renderJobId = (id: string, speed: RenderSpeedOption, options: RenderOptions = {}) => `${id}-${renderVariant(speed, options)}`;

export class RenderQueue {
  readonly storage: ObjectStorage;
  private readonly tempDir: string | undefined;
  private readonly runner: RenderRunner;
  private readonly concurrency: number;
  private readonly maxQueued: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly afterRender: RenderQueueOptions['afterRender'];
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: Job[] = [];
  private running = 0;

  constructor(options: RenderQueueOptions) {
    if (!options.storage && !options.dataDir) throw new Error('RenderQueue needs storage or dataDir');
    this.storage = options.storage ?? new FsStorage(options.dataDir!);
    this.tempDir = options.tempDir;
    this.runner = options.runner;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.maxQueued = Math.max(1, options.maxQueued ?? 8);
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.afterRender = options.afterRender;
  }

  outputKey(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    return `${assertId(id)}/rendered-${renderVariant(speed, options)}.mp4`;
  }

  /** The MP4's file with the fs driver (tests). */
  outputFile(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no local files with STORAGE=${this.storage.kind}`);
    return this.storage.path(this.outputKey(id, speed, options));
  }

  private stateKey(id: string, speed: RenderSpeedOption, options: RenderOptions) {
    return `${assertId(id)}/render-${renderVariant(speed, options)}.json`;
  }

  /** Marks jobs a previous process left queued or rendering as failed, so a POST retries them. */
  async recover() {
    const objects = await this.storage.list({ glob: '*/render-*.json' });
    let recovered = 0;
    for (const object of objects) {
      const [id, file] = object.key.split('/') as [string, string];
      const parsed = ID.test(id) ? parseStateFile(file) : undefined;
      if (!parsed) continue;
      const state = await this.readState(id, parsed.speed, parsed.options);
      if (state && (state.status === 'queued' || state.status === 'rendering')) {
        await this.writeState(id, parsed.speed, parsed.options, {
          status: 'failed',
          error: 'interrupted by a server restart; export again to retry',
        });
        recovered++;
      }
    }
    return recovered;
  }

  /** Starts (or joins) the render for `id` at `speed` with `options` (skip inactive, captions); `identity` asked for it. */
  async enqueue(
    id: string,
    speed: RenderSpeedOption,
    options: RenderOptions = {},
    context: { identity?: Identity | undefined } = {},
  ): Promise<RenderJobView> {
    const key = renderJobId(assertId(id), speed, options);
    const existing = this.jobs.get(key);
    if (existing && (existing.status === 'queued' || existing.status === 'rendering')) return this.view(existing);
    const cached = await this.cached(id, speed, options);
    if (cached) return cached;
    if (this.waiting.length >= this.maxQueued) throw new RenderQueueFullError();

    let resolve!: () => void;
    const done = new Promise<void>((settle) => (resolve = settle));
    const job: Job = {
      id,
      speed,
      options: normalize(options),
      status: 'queued',
      progress: 0,
      controller: new AbortController(),
      done,
      resolve,
      queuedAtMs: Date.now(),
      link: captureLink(),
      identity: context.identity,
    };
    this.jobs.set(key, job);
    this.waiting.push(job);
    await this.writeState(id, speed, options, { status: 'queued' });
    this.log(`render ${key}: queued`);
    this.pump();
    return this.view(job);
  }

  async status(id: string, speed: RenderSpeedOption, options: RenderOptions = {}): Promise<RenderJobView | undefined> {
    const job = this.jobs.get(renderJobId(assertId(id), speed, options));
    if (job && job.status !== 'done') return this.view(job);
    const cached = await this.cached(id, speed, options);
    if (cached) return cached;
    if (job) return this.view(job);
    const state = await this.readState(id, speed, options);
    return state
      ? { jobId: renderJobId(id, speed, options), status: state.status, progress: 0, ...(state.error ? { error: state.error } : {}) }
      : undefined;
  }

  /** Cancels a queued or running job; returns false when there was nothing to cancel. */
  async cancel(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    const key = renderJobId(assertId(id), speed, options);
    const job = this.jobs.get(key);
    if (!job || (job.status !== 'queued' && job.status !== 'rendering')) return false;
    const index = this.waiting.indexOf(job);
    if (index >= 0) this.waiting.splice(index, 1);
    job.controller.abort(new Error('cancelled'));
    this.jobs.delete(key);
    await this.storage.delete(this.stateKey(id, speed, options));
    if (index >= 0) job.resolve();
    this.log(`render ${key}: cancelled`);
    return true;
  }

  /** Resolves when the job for `id`+`speed`+`options` settles (tests, graceful shutdown). */
  async settled(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    await this.jobs.get(renderJobId(id, speed, options))?.done;
  }

  get size() {
    return { running: this.running, queued: this.waiting.length };
  }

  private async cached(id: string, speed: RenderSpeedOption, options: RenderOptions): Promise<RenderJobView | undefined> {
    const info = await this.storage.stat(this.outputKey(id, speed, options));
    return info ? { jobId: renderJobId(id, speed, options), status: 'done', progress: 1, size: info.size } : undefined;
  }

  private view(job: Job): RenderJobView {
    const view: RenderJobView = { jobId: renderJobId(job.id, job.speed, job.options), status: job.status, progress: job.progress };
    if (job.error) view.error = job.error;
    if (job.status === 'rendering' && job.startedAt !== undefined && job.progress > 0.02) {
      const elapsed = this.now() - job.startedAt;
      view.etaMs = Math.max(0, Math.round((elapsed / job.progress) * (1 - job.progress)));
    }
    return view;
  }

  private pump() {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift() as Job;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        job.resolve();
        this.pump();
      });
    }
  }

  /**
   * One render in its own trace (`render.job`, linked to the request that queued it): the queue wait as a
   * `render.queue_wait` span, then the runner's spans (browser, page, frames, ffmpeg) and the MP4's upload.
   */
  private run(job: Job) {
    const attributes = {
      'replay.id': job.id,
      'render.speed': job.speed,
      'render.captions': job.options.captions,
      'render.skip_inactive': job.options.skipInactive,
      'render.queue_wait_ms': Date.now() - job.queuedAtMs,
    };
    return withSpan(
      'render.job',
      attributes,
      async (span) => {
        startSpan('render.queue_wait', { 'replay.id': job.id }, { startTime: job.queuedAtMs }).end();
        const failure = await this.execute(job);
        span.setAttributes({ 'render.status': job.status });
        if (job.status === 'failed') span.setError(failure);
      },
      { root: true, links: [job.link] },
    );
  }

  /** Renders and stores the job; returns why it failed (undefined when it did not). */
  private async execute(job: Job): Promise<unknown> {
    const { id, speed, options } = job;
    const key = renderJobId(id, speed, options);
    const output = this.outputKey(id, speed, options);
    // Synchronous, so the job reads as rendering as soon as it leaves the queue.
    const directory = mkdtempSync(join(this.tempDir ?? tmpdir(), 'replays-render-'));
    const temporary = join(directory, 'render.mp4');
    const timer = setTimeout(
      () => job.controller.abort(new Error(`timed out after ${Math.round(this.timeoutMs / 1000)} s`)),
      this.timeoutMs,
    );
    job.status = 'rendering';
    job.startedAt = this.now();
    this.log(`render ${key}: rendering`);
    try {
      await this.writeState(id, speed, options, { status: 'rendering' });
      await this.runner({
        id,
        speed,
        captions: options.captions,
        skipInactive: options.skipInactive,
        edits: options.edits,
        output: temporary,
        signal: job.controller.signal,
        onProgress: (progress) => {
          job.progress = Math.min(1, Math.max(job.progress, progress));
        },
      });
      job.controller.signal.throwIfAborted();
      const stored = await this.storage.upload(output, temporary, { contentType: 'video/mp4' });
      job.status = 'done';
      job.progress = 1;
      await this.storage.delete(this.stateKey(id, speed, options));
      this.log(`render ${key}: done in ${((this.now() - job.startedAt) / 1000).toFixed(1)} s`);
      if (this.afterRender) {
        const view: RenderJob = {
          id: key,
          replayId: id,
          kind: 'video',
          options: { speed, captions: options.captions, skipInactive: options.skipInactive },
          ...(job.identity ? { identity: job.identity } : {}),
        };
        await Promise.resolve()
          .then(() => this.afterRender!(view, { file: temporary, key: output, contentType: 'video/mp4', bytes: stored.size }))
          .catch((error: unknown) => this.log(`render ${key}: afterRender failed: ${summarizeError(error)}`));
      }
      return undefined;
    } catch (error) {
      // A cancelled job was already removed from the map and its state file deleted.
      if (this.jobs.get(key) !== job) return undefined;
      const reason = job.controller.signal.aborted ? job.controller.signal.reason : error;
      job.status = 'failed';
      job.error = summarizeError(reason);
      this.log(`render ${key}: failed: ${job.error.split('\n')[0]?.slice(0, 300)}`);
      await this.writeState(id, speed, options, { status: 'failed', error: job.error }).catch(() => undefined);
      return reason;
    } finally {
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async readState(id: string, speed: RenderSpeedOption, options: RenderOptions) {
    // A torn legacy write reads as no state.
    const state = await readJson<{ status?: unknown; error?: unknown }>(this.storage, this.stateKey(id, speed, options)).catch(
      () => undefined,
    );
    if (state && (state.status === 'queued' || state.status === 'rendering' || state.status === 'failed')) {
      return { status: state.status, ...(typeof state.error === 'string' ? { error: state.error } : {}) } as {
        status: RenderStatus;
        error?: string;
      };
    }
    return undefined;
  }

  private async writeState(id: string, speed: RenderSpeedOption, options: RenderOptions, state: { status: RenderStatus; error?: string }) {
    await this.storage.write(
      this.stateKey(id, speed, options),
      `${JSON.stringify({ ...state, updatedAt: new Date(this.now()).toISOString() })}\n`,
      { contentType: 'application/json; charset=utf-8' },
    );
  }
}

function assertId(id: string) {
  if (!ID.test(id)) throw Object.assign(new Error('invalid replay id'), { status: 400 });
  return id;
}

/**
 * One short line for the job status. Playwright launch errors carry pages of
 * browser logs; keep the first line plus the browser's own stderr line
 * ("error while loading shared libraries…", "No usable sandbox…").
 */
export function summarizeError(reason: unknown) {
  const lines = (reason instanceof Error ? reason.message : String(reason)).split('\n');
  const browserError = lines.find((line) => /\]\[err\] /.test(line))?.replace(/^.*\]\[err\]\s*/, '');
  return (browserError ? `${lines[0]} (${browserError})` : (lines[0] ?? '')).slice(0, 300);
}
