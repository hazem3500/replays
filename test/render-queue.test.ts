import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseStateFile,
  renderJobId,
  RenderQueue,
  RenderQueueFullError,
  type RenderRunner,
  type RenderTask,
  renderVariant,
  summarizeError,
} from '../src/server/render-queue.ts';

async function dataDir() {
  const dir = join(await mkdtemp(join(tmpdir(), 'replays-queue-')), 'data');
  await mkdir(dir, { recursive: true });
  return dir;
}

/** A runner the test finishes by hand: `release(id)` writes the MP4, `fail(id)` rejects. */
function manualRunner() {
  const pending = new Map<string, { task: RenderTask; resolve: () => void; reject: (error: Error) => void }>();
  const started: string[] = [];
  const runner: RenderRunner = (task) =>
    new Promise<void>((resolve, reject) => {
      started.push(task.id);
      pending.set(task.id, { task, resolve, reject });
      task.signal.addEventListener('abort', () => reject(task.signal.reason as Error), { once: true });
    });
  const release = async (id: string) => {
    const job = pending.get(id)!;
    job.task.onProgress(1);
    await writeFile(job.task.output, 'mp4');
    job.resolve();
  };
  return { runner, started, pending, release, fail: (id: string) => pending.get(id)!.reject(new Error('boom')) };
}

// Long enough for a job to reach its runner (mkdir + state file) even while the integration renders load the machine.
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('render queue', () => {
  it('is idempotent per replay and speed, then serves the cached file', async () => {
    const dir = await dataDir();
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: dir, runner: manual.runner });
    const first = await queue.enqueue('a', 1);
    const again = await queue.enqueue('a', 1);
    expect(first.jobId).toBe('a-1x-skip');
    expect(again.jobId).toBe('a-1x-skip');
    await tick();
    expect(manual.started).toEqual(['a']);
    manual.pending.get('a')!.task.onProgress(0.5);
    expect(await queue.status('a', 1)).toMatchObject({ status: 'rendering', progress: 0.5 });

    await manual.release('a');
    await queue.settled('a', 1);
    expect(await queue.status('a', 1)).toMatchObject({ status: 'done', progress: 1, size: 3 });
    expect(await queue.enqueue('a', 1)).toMatchObject({ status: 'done' });
    expect(manual.started).toEqual(['a']);
    await expect(readFile(queue.outputFile('a', 1), 'utf8')).resolves.toBe('mp4');
    // The state file is gone once the MP4 exists.
    await expect(stat(join(dir, 'a', 'render-1x-skip.json'))).rejects.toThrow(/ENOENT/);
  });

  it('treats each speed as its own job', async () => {
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manualRunner().runner, concurrency: 2 });
    expect((await queue.enqueue('a', 1)).jobId).toBe('a-1x-skip');
    expect((await queue.enqueue('a', 2)).jobId).toBe('a-2x-skip');
  });

  it('treats captions on and off as separate jobs, files and state, each idempotent', async () => {
    const dir = await dataDir();
    const tasks: RenderTask[] = [];
    const finish: Array<() => Promise<void>> = [];
    const queue = new RenderQueue({
      dataDir: dir,
      concurrency: 4,
      runner: (task) =>
        new Promise<void>((resolve) => {
          tasks.push(task);
          finish.push(async () => {
            await writeFile(task.output, task.captions ? 'cc' : 'plain');
            resolve();
          });
        }),
    });
    expect((await queue.enqueue('a', 1)).jobId).toBe('a-1x-skip');
    expect((await queue.enqueue('a', 1, { captions: true })).jobId).toBe('a-1x-skip-cc');
    expect((await queue.enqueue('a', 1, { captions: true })).jobId).toBe('a-1x-skip-cc');
    expect((await queue.enqueue('a', 2, { captions: true })).jobId).toBe('a-2x-skip-cc');
    await tick();
    expect(tasks.map((task) => [task.speed, task.captions])).toEqual([
      [1, false],
      [1, true],
      [2, true],
    ]);
    await expect(stat(join(dir, 'a', 'render-1x-skip-cc.json'))).resolves.toBeTruthy();
    await Promise.all(finish.map((done) => done()));
    await Promise.all([queue.settled('a', 1), queue.settled('a', 1, { captions: true }), queue.settled('a', 2, { captions: true })]);
    expect(queue.outputFile('a', 1, { captions: true })).toBe(join(dir, 'a', 'rendered-1x-skip-cc.mp4'));
    await expect(readFile(queue.outputFile('a', 1), 'utf8')).resolves.toBe('plain');
    await expect(readFile(queue.outputFile('a', 1, { captions: true }), 'utf8')).resolves.toBe('cc');
    expect(await queue.status('a', 1, { captions: true })).toMatchObject({ jobId: 'a-1x-skip-cc', status: 'done', size: 2 });
    expect(await queue.enqueue('a', 1, { captions: true })).toMatchObject({ status: 'done' });
    expect(tasks).toHaveLength(3);
    // Cancelling one variant leaves the other alone; a missing variant has no status.
    expect(await queue.cancel('a', 1, { captions: true })).toBe(false);
    expect(await queue.status('a', 2)).toBeUndefined();
  });

  it('names every speed / skip / captions variant, keeping the default names', async () => {
    // Skip inactive is on unless asked otherwise (the player's default); names always mark it, so the
    // renders from before it existed (`rendered-1x.mp4`, no skipping) are the `skipInactive: false` variant.
    expect(renderVariant(1)).toBe('1x-skip');
    expect(renderVariant(1, { skipInactive: false })).toBe('1x');
    expect(renderVariant(2, { captions: true })).toBe('2x-skip-cc');
    expect(renderVariant(0.5, { skipInactive: false, captions: true })).toBe('0.5x-cc');
    expect(renderJobId('a', 8, { skipInactive: true })).toBe('a-8x-skip');
    expect(parseStateFile('render-1.5x-skip-cc.json')).toEqual({ speed: 1.5, options: { skipInactive: true, captions: true } });
    expect(parseStateFile('render-1x.json')).toEqual({ speed: 1, options: { skipInactive: false, captions: false } });
    expect(parseStateFile('render-3x.json')).toBeUndefined();
    expect(parseStateFile('rendered-1x.mp4')).toBeUndefined();
    const dir = await dataDir();
    const queue = new RenderQueue({ dataDir: dir, runner: manualRunner().runner, concurrency: 4 });
    expect(queue.outputFile('a', 1, { skipInactive: false })).toBe(join(dir, 'a', 'rendered-1x.mp4'));
    expect(queue.outputFile('a', 4)).toBe(join(dir, 'a', 'rendered-4x-skip.mp4'));
    expect((await queue.enqueue('a', 4)).jobId).toBe('a-4x-skip');
    expect((await queue.enqueue('a', 4, { skipInactive: false })).jobId).toBe('a-4x');
    expect((await queue.enqueue('a', 4, { skipInactive: true })).jobId).toBe('a-4x-skip');
    expect(queue.size).toEqual({ running: 2, queued: 0 });
  });

  it('runs one job at a time by default and queues the rest', async () => {
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manual.runner });
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 1);
    await tick();
    expect(manual.started).toEqual(['a']);
    expect(await queue.status('b', 1)).toMatchObject({ status: 'queued' });
    expect(queue.size).toEqual({ running: 1, queued: 1 });
    await manual.release('a');
    await queue.settled('a', 1);
    await tick();
    expect(manual.started).toEqual(['a', 'b']);
  });

  it('honours a higher concurrency', async () => {
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manual.runner, concurrency: 2 });
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 1);
    await queue.enqueue('c', 1);
    await tick();
    expect(manual.started).toEqual(['a', 'b']);
  });

  it('bounds the waiting list', async () => {
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manualRunner().runner, maxQueued: 1 });
    await queue.enqueue('a', 1); // starts running at once
    await queue.enqueue('b', 1); // waits
    await expect(queue.enqueue('c', 1)).rejects.toBeInstanceOf(RenderQueueFullError);
  });

  it('cancels queued and running jobs', async () => {
    const dir = await dataDir();
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: dir, runner: manual.runner });
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 1);
    await tick();
    expect(await queue.cancel('b', 1)).toBe(true);
    expect(await queue.cancel('a', 1)).toBe(true);
    expect(await queue.cancel('a', 1)).toBe(false);
    await tick();
    expect(manual.started).toEqual(['a']);
    expect(await queue.status('a', 1)).toBeUndefined();
    expect(await queue.status('b', 1)).toBeUndefined();
    await expect(stat(queue.outputFile('a', 1))).rejects.toThrow(/ENOENT/);
    // A cancelled job can be started again (it starts at once: nothing else is running).
    expect(await queue.enqueue('a', 1)).toMatchObject({ status: 'rendering' });
  });

  it('fails a job that runs past its timeout and lets it be retried', async () => {
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manual.runner, timeoutMs: 20 });
    await queue.enqueue('a', 1);
    await queue.settled('a', 1);
    expect(await queue.status('a', 1)).toMatchObject({ status: 'failed', error: expect.stringContaining('timed out') });
    expect(await queue.enqueue('a', 1)).toMatchObject({ status: 'rendering' });
  });

  it('reports runner errors as failed', async () => {
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manual.runner });
    await queue.enqueue('a', 1);
    await tick();
    manual.fail('a');
    await queue.settled('a', 1);
    expect(await queue.status('a', 1)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('marks jobs a crashed process left behind as failed and retryable', async () => {
    const dir = await dataDir();
    const before = new RenderQueue({ dataDir: dir, runner: manualRunner().runner });
    await before.enqueue('a', 1); // rendering
    await before.enqueue('b', 2); // queued
    await before.enqueue('b', 1, { captions: true }); // queued, captioned
    await before.enqueue('b', 0.5, { skipInactive: false, captions: true }); // queued, full idle time
    await tick();
    // "Restart": a fresh queue over the same directory.
    const manual = manualRunner();
    const after = new RenderQueue({ dataDir: dir, runner: manual.runner });
    expect(await after.recover()).toBe(4);
    expect(await after.status('b', 0.5, { skipInactive: false, captions: true })).toMatchObject({
      jobId: 'b-0.5x-cc',
      status: 'failed',
    });
    expect(await after.status('b', 1, { captions: true })).toMatchObject({ jobId: 'b-1x-skip-cc', status: 'failed' });
    expect(await after.status('a', 1)).toMatchObject({ status: 'failed', error: expect.stringContaining('restart') });
    expect(await after.status('b', 2)).toMatchObject({ status: 'failed' });
    expect(await after.enqueue('a', 1)).toMatchObject({ status: 'rendering' });
    await tick();
    expect(manual.started).toEqual(['a']);
  });

  it('estimates the time left from progress', async () => {
    let now = 1_000;
    const manual = manualRunner();
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manual.runner, now: () => now });
    await queue.enqueue('a', 1);
    // Under a loaded test run the job can take longer than one tick to start.
    while (!manual.pending.has('a')) await tick();
    now += 4_000;
    manual.pending.get('a')!.task.onProgress(0.4);
    expect(await queue.status('a', 1)).toMatchObject({ progress: 0.4, etaMs: 6_000 });
  });

  it('rejects ids that could escape the data directory', async () => {
    const queue = new RenderQueue({ dataDir: await dataDir(), runner: manualRunner().runner });
    await expect(queue.enqueue('../x', 1)).rejects.toMatchObject({ status: 400 });
  });

  it('summarizes long browser launch errors to one line', () => {
    const message = [
      'browserType.launch: Target page, context or browser has been closed',
      'Browser logs:',
      '<launching> /ms-playwright/chrome-headless-shell --a --b',
      '[pid=29][err] /ms-playwright/chrome-headless-shell: error while loading shared libraries: libx.so.0',
    ].join('\n');
    expect(summarizeError(new Error(message))).toBe(
      'browserType.launch: Target page, context or browser has been closed (/ms-playwright/chrome-headless-shell: error while loading shared libraries: libx.so.0)',
    );
    expect(summarizeError('x'.repeat(500))).toHaveLength(300);
  });
});
