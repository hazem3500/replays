import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RenderQueue } from '../src/server/render-queue.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';
import { withRenderScope } from '../src/server/render-scope.ts';

describe('Effect render resource scope', () => {
  it('releases scratch files on success and retains the original failure on rejection', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-test-'));
    const controller = new AbortController();
    expect(
      await withRenderScope({ tempDir, controller, timeoutMs: 60_000 }, async (directory) => {
        expect((await stat(directory)).isDirectory()).toBe(true);
        return 'rendered';
      }),
    ).toBe('rendered');
    expect(await readdir(tempDir)).toEqual([]);
    const failure = new Error('upload unavailable');
    await expect(
      withRenderScope({ tempDir, controller, timeoutMs: 60_000 }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await readdir(tempDir)).toEqual([]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('does not delete a cancelling runner’s scratch directory before that runner has actually stopped', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-cancel-'));
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const stopped = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let directory = '';
    const running = withRenderScope({ tempDir, controller, timeoutMs: 60_000 }, async (path) => {
      directory = path;
      started();
      await stopped;
      controller.signal.throwIfAborted();
    });
    await ready;
    const reason = new Error('cancelled');
    controller.abort(reason);
    expect((await stat(directory)).isDirectory()).toBe(true);
    finish();
    await expect(running).rejects.toBe(reason);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('propagates the deadline through the existing signal and finalizes after rejection', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-timeout-'));
    const controller = new AbortController();
    await expect(
      withRenderScope(
        { tempDir, controller, timeoutMs: 10 },
        async () =>
          new Promise<void>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
          }),
      ),
    ).rejects.toThrow('timed out');
    expect(await readdir(tempDir)).toEqual([]);
  });
});

describe('render queue scoped ownership', () => {
  it('cleans up scratch output and preserves failed status on a storage upload failure', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-upload-'));
    const storage = new MemoryStorage();
    vi.spyOn(storage, 'upload').mockRejectedValueOnce(new Error('upload unavailable'));
    const queue = new RenderQueue({
      tempDir,
      storage,
      runner: async (task) => {
        await writeFile(task.output, 'mp4');
      },
    });
    await queue.enqueue('upload-failure', 1);
    await queue.settled('upload-failure', 1);
    expect(await queue.status('upload-failure', 1)).toMatchObject({ status: 'failed', error: 'upload unavailable' });
    expect(await readdir(tempDir)).toEqual([]);
    await queue.close();
  });

  it('shutdown aborts running jobs, removes queued jobs and waits for the runner before removing its files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-shutdown-'));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observeAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      observeAbort = resolve;
    });
    let finish!: () => void;
    const stopped = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runs: string[] = [];
    let output = '';
    const queue = new RenderQueue({
      tempDir,
      storage: new MemoryStorage(),
      runner: async (task) => {
        runs.push(task.id);
        output = task.output;
        task.signal.addEventListener('abort', observeAbort, { once: true });
        started();
        await stopped;
        task.signal.throwIfAborted();
      },
    });
    await queue.enqueue('running', 1);
    await ready;
    await queue.enqueue('queued', 1);
    const closing = queue.close();
    await aborted;
    expect((await stat(join(output, '..'))).isDirectory()).toBe(true);
    finish();
    await closing;
    expect(runs).toEqual(['running']);
    expect(await readdir(tempDir)).toEqual([]);
    await expect(queue.enqueue('after-shutdown', 1)).rejects.toMatchObject({ status: 503 });
  });
});

it('never admits a job after shutdown overtakes its asynchronous cache lookup', async () => {
  const storage = new MemoryStorage();
  let release!: () => void;
  vi.spyOn(storage, 'stat').mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        release = () => resolve(undefined);
      }),
  );
  const runner = vi.fn<import('../src/server/render-queue.ts').RenderRunner>(async () => {});
  const queue = new RenderQueue({ storage, runner });
  const admission = queue.enqueue('late', 1);
  const rejected = admission.catch((error: unknown) => error);
  const closing = queue.close();
  release();
  await closing;
  expect(await rejected).toMatchObject({ status: 503 });
  expect(runner).not.toHaveBeenCalled();
  expect(queue.size).toEqual({ queued: 0, running: 0 });
});

it('drains a runner and releases its scratch files even when cancellation state deletion fails', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'replays-scope-delete-failure-'));
  const storage = new MemoryStorage();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const queue = new RenderQueue({
    tempDir,
    storage,
    runner: async (task) => {
      started();
      await new Promise<void>((_resolve, reject) =>
        task.signal.addEventListener('abort', () => reject(task.signal.reason), { once: true }),
      );
    },
  });
  await queue.enqueue('delete-failure', 1);
  await ready;
  vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('state delete unavailable'));
  await expect(queue.close()).rejects.toThrow('render shutdown cleanup failed');
  expect(await readdir(tempDir)).toEqual([]);
  expect(queue.size.running).toBe(0);
});
