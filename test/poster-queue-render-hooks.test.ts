import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Owned } from '../src/plugin/registry.ts';
import type { RenderHooks } from '../src/plugin/types.ts';
import { PosterQueue, type PosterTask } from '../src/server/media/poster-queue.ts';
import { createRenderHooks } from '../src/server/render-hooks.ts';
import { ReplayStore } from '../src/server/store.ts';
import { replay } from './fixtures.ts';

const owned = (plugin: string, value: RenderHooks): Owned<RenderHooks> => ({ plugin, value });

/** A poster queue on a real store, wired to `hooks` as start.ts wires the plugins'. */
async function posterQueue(hooks: Array<Owned<RenderHooks>>, busy: () => boolean = () => false) {
  const root = await mkdtemp(join(tmpdir(), 'replays-render-hooks-posters-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const tasks: PosterTask[] = [];
  const openTasks: PosterTask[] = [];
  const runner = createRenderHooks(hooks, () => {});
  const posters = new PosterQueue({
    storage: store.storage,
    key: (id, choice) => store.posterKey(id, choice),
    posterAt: runner.posterChooser({
      profile: (id) => store.summary(id, { suites: false }).then((summary) => summary?.profile),
      load: (id) => store.load(id),
    }),
    beforeRender: (job) => runner.beforeRender(job),
    afterRender: (job, file) => runner.afterRender(job, file),
    busy,
    waitMs: 5,
    open: {
      key: (id) => store.openStillKey(id),
      runner: async (task) => {
        openTasks.push(task);
        await writeFile(task.output, 'open');
      },
    },
    runner: async (task) => {
      tasks.push(task);
      await writeFile(task.output, 'jpeg');
      await writeFile(`${task.output}.open.jpg`, 'open');
    },
  });
  return { store, posters, tasks, openTasks };
}

describe('the poster queue with render hooks', () => {
  it('takes the poster at the hook moment, under a key that names it, and reports both stored files', async () => {
    const done: string[] = [];
    const { store, posters, tasks } = await posterQueue([
      owned('moment', { posterAt: () => 400, afterRender: (job, file) => void done.push(`${job.kind}:${file.key}`) }),
    ]);
    await posters.request('test-replay');
    await posters.settled('test-replay');
    expect(tasks.map((task) => task.moment)).toEqual([400]);
    expect(await posters.key('test-replay')).toBe('test-replay/poster.v2-t400.jpg');
    await expect(readFile(store.posterFile('test-replay', 400), 'utf8')).resolves.toBe('jpeg');
    await expect(posters.request('test-replay')).resolves.toBe('ready');
    expect(done).toEqual(['poster:test-replay/poster.v2-t400.jpg', 'open:test-replay/open.v2.jpg']);
  });

  it('fails a vetoed job without running it', async () => {
    const { posters, tasks } = await posterQueue([owned('deny', { beforeRender: (job) => (job.kind === 'poster' ? false : undefined) })]);
    await posters.request('test-replay');
    await posters.settled('test-replay');
    expect(tasks).toEqual([]);
    await expect(posters.request('test-replay')).resolves.toBe('failed');
  });
});

describe('opening stills in the poster queue with render hooks', () => {
  it.each([false, true])('honours an opening-still veto while the poster completes (open queued: %s)', async (queued) => {
    let busy = true;
    const checked: string[] = [];
    const done: string[] = [];
    const { store, posters, tasks, openTasks } = await posterQueue(
      [
        owned('deny-open', {
          beforeRender: (job) => {
            checked.push(job.kind);
            return job.kind === 'open' ? false : undefined;
          },
          afterRender: (job) => void done.push(job.kind),
        }),
      ],
      () => busy,
    );
    await posters.request('test-replay');
    if (queued) await posters.request('test-replay', 'open');
    const opening = posters.settled('test-replay', 'open');
    busy = false;
    await posters.settled('test-replay');
    await opening;
    expect(checked).toEqual(['poster', 'open']);
    expect(tasks).toHaveLength(1);
    expect(openTasks).toEqual([]);
    await expect(store.storage.read(store.openStillKey('test-replay'))).resolves.toBeUndefined();
    await expect(posters.request('test-replay')).resolves.toBe('ready');
    await expect(posters.request('test-replay', 'open')).resolves.toBe('failed');
    expect(done).toEqual(['poster']);
    expect(posters.timings.map((timing) => timing.kind)).toEqual(['poster']);
    expect(posters.size).toEqual({ running: 0, queued: 0 });
  });

  it('settles a scheduled opening still from an allowed poster without running it twice', async () => {
    let busy = true;
    const checked: string[] = [];
    const done: string[] = [];
    const { store, posters, openTasks } = await posterQueue(
      [owned('allow', { beforeRender: (job) => void checked.push(job.kind), afterRender: (job) => void done.push(job.kind) })],
      () => busy,
    );
    await posters.request('test-replay');
    await posters.request('test-replay', 'open');
    const opening = posters.settled('test-replay', 'open');
    busy = false;
    await posters.settled('test-replay');
    await opening;
    expect(checked).toEqual(['poster', 'open']);
    expect(done).toEqual(['poster', 'open']);
    expect(openTasks).toEqual([]);
    await expect(readFile(store.openStillFile('test-replay'), 'utf8')).resolves.toBe('open');
    await expect(posters.request('test-replay', 'open')).resolves.toBe('ready');
  });
});

describe('cached and standalone opening stills with render hooks', () => {
  it.each([false, true])('preserves a cached opening still and does not notify it again (open vetoed: %s)', async (vetoed) => {
    const done: string[] = [];
    const { store, posters, openTasks } = await posterQueue([
      owned('notify', {
        beforeRender: (job) => (vetoed && job.kind === 'open' ? false : undefined),
        afterRender: (job) => void done.push(job.kind),
      }),
    ]);
    await writeFile(store.openStillFile('test-replay'), 'cached-open');
    await expect(posters.request('test-replay', 'open')).resolves.toBe('ready');
    await posters.request('test-replay');
    await posters.settled('test-replay');
    await expect(readFile(store.openStillFile('test-replay'), 'utf8')).resolves.toBe('cached-open');
    expect(done).toEqual(['poster']);
    expect(openTasks).toEqual([]);
  });

  it.each([false, true])('checks a standalone scheduled opening still before running it (open vetoed: %s)', async (vetoed) => {
    const done: string[] = [];
    const checked: string[] = [];
    const { posters, tasks, openTasks } = await posterQueue([
      owned('policy', {
        beforeRender: (job) => {
          checked.push(job.kind);
          return vetoed ? false : undefined;
        },
        afterRender: (job) => void done.push(job.kind),
      }),
    ]);
    await posters.request('test-replay', 'open');
    await posters.settled('test-replay', 'open');
    expect(checked).toEqual(['open']);
    expect(tasks).toEqual([]);
    expect(openTasks).toHaveLength(vetoed ? 0 : 1);
    expect(done).toEqual(vetoed ? [] : ['open']);
    await expect(posters.request('test-replay', 'open')).resolves.toBe(vetoed ? 'failed' : 'ready');
  });
});
