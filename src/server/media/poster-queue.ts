import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { RenderedFile, RenderJob } from '../../plugin/types.ts';
import { isThumbHash } from '../../shared/thumbhash.ts';
import type { RenderVerdict } from '../render-hooks.ts';
import { ObjectExistsError, type ObjectInfo, type ObjectStorage } from '../storage/index.ts';
import type { PosterChoice } from '../store.ts';
import { captureLink, type TraceLink, withSpan } from '../tracing.ts';

/** A failed job is not retried for this long (the client keeps the poster or placeholder meanwhile). */
const RETRY_FAILED_MS = 10 * 60_000;
const SIDECAR_TYPE = 'application/json; charset=utf-8';

export type MediaKind = 'poster' | 'open' | 'preview';

/** The stored content type of each kind of list media. */
export const MEDIA_TYPE: Readonly<Record<MediaKind, string>> = { poster: 'image/jpeg', open: 'image/jpeg', preview: 'video/mp4' };

export interface PosterTask {
  id: string;
  /** Where the poster is taken: a named moment or a time in ms (posterAt; absent: the default moment). Posters only. */
  moment?: PosterChoice;
  /** Write the file here, a local temporary path (the queue stores it, and an optional `<output>.json` sidecar). */
  output: string;
  signal: AbortSignal;
}

export type PosterRunner = (task: PosterTask) => Promise<void>;

export type PosterState = 'ready' | 'pending' | 'failed' | 'full' | 'off';

export interface PosterQueueOptions {
  /** Where finished media are stored (ReplayStore.storage). */
  storage: ObjectStorage;
  /** The finished poster's key (ReplayStore.posterKey), for the moment `posterAt` chose. */
  key: (id: string, choice?: PosterChoice) => string;
  runner: PosterRunner;
  /** The poster moment for a replay (render-hooks.ts posterChooser); absent or undefined means the default. */
  posterAt?: ((id: string) => Promise<PosterChoice | undefined>) | undefined;
  /** The plugins' `beforeRender`: a refused job fails (and is retried like any failure). */
  beforeRender?: ((job: RenderJob) => Promise<RenderVerdict>) | undefined;
  /** The plugins' `afterRender`, after each stored file (the poster job's opening still too). Errors are logged. */
  afterRender?: ((job: RenderJob, file: RenderedFile) => void | Promise<void>) | undefined;
  /** Keeps a finished poster's ThumbHash (its runner's `<output>.json` sidecar) with the replay's summary. Errors are logged. */
  thumbhash?: ((id: string, hash: string) => Promise<void>) | undefined;
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

type Defaulted = 'busy' | 'maxQueued' | 'timeoutMs' | 'waitMs' | 'now' | 'log';
type QueueSettings = Omit<PosterQueueOptions, Defaulted> & Required<Pick<PosterQueueOptions, Defaulted>>;

interface Job {
  kind: MediaKind;
  id: string;
  /** Wall-clock enqueue time and the requesting span, for the job's own trace (tracing.ts). */
  queuedAtMs: number;
  link: TraceLink | undefined;
}

/** A finished file and the render job it answers, for `afterRender`. */
type Made = [RenderJob, RenderedFile];

const nameOf = (kind: MediaKind, id: string): string => `${kind}:${id}`;
const renderJob = (id: string, kind: MediaKind): RenderJob => ({ id: `${id}-${kind}`, replayId: id, kind, options: {} });
const firstLine = (error: unknown): string => (String(error instanceof Error ? error.message : error).split('\n')[0] ?? '').slice(0, 300);
const fileExists = async (path: string): Promise<boolean> => Boolean(await stat(path).catch(() => null));

async function readThumbHash(sidecar: string): Promise<unknown> {
  const text = await readFile(sidecar, 'utf8').catch(() => null);
  if (text === null) return;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && 'thumbhash' in parsed ? parsed.thumbhash : undefined;
  } catch {
    return;
  }
}

/**
 * List media for the replay index, one job at a time (posters, then opening stills, then previews), only while no video
 * export is running, so list media never slow an export. Made in a local temporary directory, then stored with the
 * replay (ReplayStore keys) and pruned with it. List requests never wait for them.
 */
export class PosterQueue {
  private readonly options: QueueSettings;
  /** Posters first: they are what the list shows; then opening stills (opening a replay); previews only play on hover. */
  private readonly waiting: Record<MediaKind, Job[]> = { poster: [], open: [], preview: [] };
  private readonly pending = new Set<string>();
  private readonly failed = new Map<string, number>();
  private readonly settledBy = new Map<string, { done: Promise<void>; resolve: () => void }>();
  private running = false;
  /** Milliseconds each finished job took, newest last (logs, measurements). */
  readonly timings: Array<{ kind: MediaKind; id: string; ms: number; bytes: number }> = [];

  constructor(options: PosterQueueOptions) {
    this.options = { busy: () => false, maxQueued: 200, timeoutMs: 120_000, waitMs: 2000, now: Date.now, log: () => {}, ...options };
  }

  /** Whether `kind` can be made here at all (previews need ffmpeg). */
  supports(kind: MediaKind): boolean {
    return kind === 'poster' || Boolean(kind === 'open' ? this.options.open : this.options.preview);
  }

  /** The stored file's key; a poster's names the moment `posterAt` chooses for the replay (memoised there). */
  async key(id: string, kind: MediaKind = 'poster'): Promise<string> {
    if (kind === 'poster') return this.options.key(id, await this.options.posterAt?.(id));
    return this.source(kind).key(id);
  }

  async exists(id: string, kind: MediaKind = 'poster'): Promise<boolean> {
    return Boolean(await this.options.storage.stat(await this.key(id, kind)));
  }

  /** The file's state, queueing it when it is neither stored, queued nor recently failed. */
  async request(id: string, kind: MediaKind = 'poster'): Promise<PosterState> {
    if (!this.supports(kind)) return 'off';
    const name = nameOf(kind, id);
    if (this.pending.has(name)) return 'pending';
    if (await this.exists(id, kind)) return 'ready';
    const failedAt = this.failed.get(name);
    if (failedAt !== undefined && this.options.now() - failedAt < RETRY_FAILED_MS) return 'failed';
    if (this.queued >= this.options.maxQueued) return 'full';
    this.failed.delete(name);
    this.pending.add(name);
    this.waiting[kind].push({ kind, id, queuedAtMs: Date.now(), link: captureLink() });
    let resolve: (() => void) | undefined;
    const done = new Promise<void>((settle) => {
      resolve = settle;
    });
    this.settledBy.set(name, { done, resolve: () => resolve?.() });
    void this.pump();
    return 'pending';
  }

  /** Resolves when `id`'s job of `kind` settles (tests, warm-up scripts). */
  async settled(id: string, kind: MediaKind = 'poster'): Promise<void> {
    await this.settledBy.get(nameOf(kind, id))?.done;
  }

  get size(): { running: number; queued: number } {
    return { running: this.running ? 1 : 0, queued: this.queued };
  }

  private get queued() {
    return this.waiting.poster.length + this.waiting.open.length + this.waiting.preview.length;
  }

  private source(kind: 'open' | 'preview') {
    const source = this.options[kind];
    if (!source) throw new Error(`${kind} media are off`);
    return source;
  }

  private settle(name: string) {
    this.pending.delete(name);
    this.settledBy.get(name)?.resolve();
    this.settledBy.delete(name);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queued > 0) {
        while (this.options.busy()) await new Promise((resolve) => setTimeout(resolve, this.options.waitMs));
        const job = this.waiting.poster.shift() ?? this.waiting.open.shift() ?? this.waiting.preview.shift();
        if (!job) break;
        const name = nameOf(job.kind, job.id);
        try {
          await this.run(job);
        } catch (error) {
          this.failed.set(name, this.options.now());
          this.options.log(`${job.kind} ${job.id}: failed: ${String(error)}`);
        } finally {
          this.settle(name);
        }
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
    this.settle(nameOf(kind, id));
  }

  /** One poster, opening still or preview in its own trace (`media.<kind>`), linked to the request that queued it. */
  private run(job: Job) {
    const attributes = { 'replay.id': job.id, 'media.kind': job.kind, 'media.queue_wait_ms': Date.now() - job.queuedAtMs };
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
    let directory: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${kind} timed out`)), this.options.timeoutMs);
    const started = this.options.now();
    try {
      directory = await mkdtemp(join(this.options.tempDir ?? tmpdir(), `replays-${kind}-`));
      const made = await this.make(kind, id, { directory, signal: controller.signal });
      for (const [job, file] of made) await this.afterRender(job, file);
      const bytes = made[0]?.[1].bytes ?? 0;
      const ms = this.options.now() - started;
      this.timings.push({ kind, id, ms, bytes });
      if (this.timings.length > 200) this.timings.shift();
      this.options.log(`${kind} ${id}: done in ${(ms / 1000).toFixed(1)} s (${Math.round(bytes / 1024)} KB)`);
      return;
    } catch (error) {
      this.failed.set(nameOf(kind, id), this.options.now());
      this.options.log(`${kind} ${id}: failed: ${firstLine(error)}`);
      return error;
    } finally {
      clearTimeout(timer);
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  /** Runs the job's runner and stores what it made: the file, its sidecar, and a poster's ThumbHash and opening still. */
  private async make(kind: MediaKind, id: string, work: { directory: string; signal: AbortSignal }): Promise<Made[]> {
    const verdict = await this.options.beforeRender?.(renderJob(id, kind));
    if (verdict && !verdict.ok) throw new Error(`refused by plugin ${verdict.plugin}: ${verdict.error}`);
    // invariant: one choice names the file and seeks the page, so the key always says what the file shows.
    const moment = kind === 'poster' ? await this.options.posterAt?.(id) : undefined;
    const output = kind === 'poster' ? this.options.key(id, moment) : await this.key(id, kind);
    const temporary = join(work.directory, `${kind}${extname(output)}`);
    const runner = kind === 'poster' ? this.options.runner : this.source(kind).runner;
    await runner({ id, output: temporary, signal: work.signal, ...(moment === undefined ? {} : { moment }) });
    work.signal.throwIfAborted();
    // why: the sidecar goes first, so whoever sees the media also sees what it covers.
    if (await fileExists(`${temporary}.json`))
      await this.options.storage.upload(`${output}.json`, `${temporary}.json`, { contentType: SIDECAR_TYPE });
    const stored = await this.options.storage.upload(output, temporary, { contentType: MEDIA_TYPE[kind] });
    const made: Made[] = [[renderJob(id, kind), { file: temporary, key: output, contentType: MEDIA_TYPE[kind], bytes: stored.size }]];
    if (kind !== 'poster') return made;
    await this.keepThumbHash(id, `${temporary}.json`);
    const open = await this.storeOpenStill(id, `${temporary}.open.jpg`);
    return open ? [...made, open] : made;
  }

  /**
   * The opening still the poster runner shot on the way. It is a separate artifact, so its own `beforeRender` must allow
   * keeping it; a stored one settles any waiting opening-still job.
   */
  private async storeOpenStill(id: string, file: string): Promise<Made | undefined> {
    const open = this.options.open;
    if (!open || !(await fileExists(file))) return;
    const job = renderJob(id, 'open');
    const verdict = await this.options.beforeRender?.(job);
    if (verdict && !verdict.ok) {
      this.failed.set(nameOf('open', id), this.options.now());
      this.dequeue('open', id);
      this.options.log(`open ${id}: refused by plugin ${verdict.plugin}: ${verdict.error}`);
      return;
    }
    const key = open.key(id);
    const kept = await this.uploadOnce(key, file);
    if (!kept) return;
    this.dequeue('open', id);
    return [job, { file, key, contentType: MEDIA_TYPE.open, bytes: kept.size }];
  }

  private async uploadOnce(key: string, file: string): Promise<ObjectInfo | undefined> {
    try {
      return await this.options.storage.upload(key, file, { createOnly: true, contentType: MEDIA_TYPE.open });
    } catch (error) {
      if (error instanceof ObjectExistsError) return;
      throw error;
    }
  }

  private async afterRender(job: RenderJob, file: RenderedFile) {
    await Promise.resolve()
      .then(() => this.options.afterRender?.(job, file))
      .catch((error: unknown) =>
        this.options.log(`${job.kind} ${job.replayId}: afterRender failed: ${String(error instanceof Error ? error.message : error)}`),
      );
  }

  private async keepThumbHash(id: string, sidecar: string) {
    const keep = this.options.thumbhash;
    if (!keep) return;
    const hash = await readThumbHash(sidecar);
    if (!isThumbHash(hash)) return;
    await keep(id, hash).catch((error: unknown) => this.options.log(`poster ${id}: thumbhash not kept: ${String(error)}`));
  }
}
