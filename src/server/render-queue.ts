import { join } from 'node:path';

import type { RenderedFile, RenderJob } from '../plugin/types.ts';
import type { Identity } from './auth/types.ts';
import {
  assertRenderId,
  normalizeRenderOptions,
  renderJobId,
  renderOutputKey,
  type RenderOptions,
  type RenderSpeedOption,
  summarizeError,
} from './media/render-names.ts';
import { type RenderStatus, RenderStates } from './media/render-state.ts';
import { withRenderScope } from './render-scope.ts';
import { FsStorage, type ObjectStorage } from './storage/index.ts';
import { captureLink, startSpan, type TraceLink, withSpan } from './tracing.ts';

export {
  EDITS_VERSION_PATTERN,
  parseStateFile,
  RENDER_SPEED_OPTIONS,
  renderJobId,
  type RenderOptions,
  type RenderSpeedOption,
  renderVariant,
  summarizeError,
} from './media/render-names.ts';
export type { RenderStatus } from './media/render-state.ts';

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
  readonly expose = true;
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

export class RenderQueue {
  private closed = false;
  private readonly active = new Set<Job>();
  private readonly admissions = new Set<Promise<RenderJobView>>();
  readonly storage: ObjectStorage;
  private readonly tempDir: string | undefined;
  private readonly runner: RenderRunner;
  private readonly concurrency: number;
  private readonly maxQueued: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly afterRender: RenderQueueOptions['afterRender'];
  private readonly states: RenderStates;
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
    this.states = new RenderStates(this.storage, this.now);
  }

  outputKey(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    return renderOutputKey(id, speed, options);
  }

  /** The MP4's file with the fs driver (tests). */
  outputFile(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    if (!(this.storage instanceof FsStorage)) throw new Error(`no local files with STORAGE=${this.storage.kind}`);
    return this.storage.path(this.outputKey(id, speed, options));
  }

  /** Marks jobs a previous process left queued or rendering as failed, so a POST retries them. */
  async recover() {
    return this.states.recover();
  }

  /** Starts (or joins) the render for `id` at `speed` with `options` (skip inactive, captions); `identity` asked for it. */
  enqueue(
    id: string,
    speed: RenderSpeedOption,
    options: RenderOptions = {},
    context: { identity?: Identity | undefined } = {},
  ): Promise<RenderJobView> {
    const admission = this.enqueueJob(id, speed, options, context);
    this.admissions.add(admission);
    void admission.finally(() => this.admissions.delete(admission)).catch(() => {});
    return admission;
  }

  private async enqueueJob(
    id: string,
    speed: RenderSpeedOption,
    options: RenderOptions,
    context: { identity?: Identity | undefined },
  ): Promise<RenderJobView> {
    if (this.closed) throw Object.assign(new Error('render queue is shutting down'), { status: 503 });
    const key = renderJobId(assertRenderId(id), speed, options);
    const existing = this.jobs.get(key);
    if (existing && (existing.status === 'queued' || existing.status === 'rendering')) return this.view(existing);
    const cached = await this.cached(id, speed, options);
    if (this.closed) throw Object.assign(new Error('render queue is shutting down'), { status: 503 });
    if (cached) return cached;
    if (this.waiting.length >= this.maxQueued) throw new RenderQueueFullError();

    let resolve!: () => void;
    const done = new Promise<void>((settle) => (resolve = settle));
    const job: Job = {
      id,
      speed,
      options: normalizeRenderOptions(options),
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
    await this.states.write({ id, speed, options }, { status: 'queued' });
    if (this.closed) {
      await this.states.remove({ id, speed, options });
      job.resolve();
      throw Object.assign(new Error('render queue is shutting down'), { status: 503 });
    }
    this.log(`render ${key}: queued`);
    this.pump();
    return this.view(job);
  }

  async status(id: string, speed: RenderSpeedOption, options: RenderOptions = {}): Promise<RenderJobView | undefined> {
    const job = this.jobs.get(renderJobId(assertRenderId(id), speed, options));
    if (job && job.status !== 'done') return this.view(job);
    const cached = await this.cached(id, speed, options);
    if (cached) return cached;
    if (job) return this.view(job);
    const state = await this.states.read({ id, speed, options });
    return state
      ? { jobId: renderJobId(id, speed, options), status: state.status, progress: 0, ...(state.error ? { error: state.error } : {}) }
      : undefined;
  }

  /** Cancels a queued or running job; returns false when there was nothing to cancel. */
  async cancel(id: string, speed: RenderSpeedOption, options: RenderOptions = {}) {
    const key = renderJobId(assertRenderId(id), speed, options);
    const job = this.jobs.get(key);
    if (!job || (job.status !== 'queued' && job.status !== 'rendering')) return false;
    const index = this.waiting.indexOf(job);
    if (index >= 0) this.waiting.splice(index, 1);
    job.controller.abort(new Error('cancelled'));
    this.jobs.delete(key);
    if (index >= 0) job.resolve();
    await this.states.remove({ id, speed, options });
    this.log(`render ${key}: cancelled`);
    return true;
  }

  /** Abort and drain owned runners before the server exits; finalizers retain files until runners settle. */
  async close() {
    this.closed = true;
    const jobs = [...new Set([...this.jobs.values(), ...this.active])];
    const cancelled = await Promise.allSettled(jobs.map((job) => this.cancel(job.id, job.speed, job.options)));
    await Promise.allSettled(this.admissions);
    await Promise.all(jobs.map((job) => job.done));
    const errors = cancelled.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (errors.length) throw new AggregateError(errors, 'render shutdown cleanup failed');
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
      this.active.add(job);
      void this.run(job).finally(() => {
        this.active.delete(job);
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
    // invariant: set synchronously, so the job reads as rendering as soon as it leaves the queue.
    job.status = 'rendering';
    const startedAt = this.now();
    job.startedAt = startedAt;
    this.log(`render ${key}: rendering`);
    try {
      return await withRenderScope({ tempDir: this.tempDir, controller: job.controller, timeoutMs: this.timeoutMs }, async (directory) => {
        const temporary = join(directory, 'render.mp4');
        await this.states.write(job, { status: 'rendering' });
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
        await this.states.remove({ id, speed, options });
        this.log(`render ${key}: done in ${((this.now() - startedAt) / 1000).toFixed(1)} s`);
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
      });
    } catch (error) {
      // why: a cancelled job was already removed from the map and its state file deleted.
      if (this.jobs.get(key) !== job) return undefined;
      const reason = job.controller.signal.aborted ? job.controller.signal.reason : error;
      job.status = 'failed';
      job.error = summarizeError(reason);
      this.log(`render ${key}: failed: ${job.error.split('\n')[0]?.slice(0, 300)}`);
      await this.states.write(job, { status: 'failed', error: job.error }).catch(() => null);
      return reason;
    }
  }
}
