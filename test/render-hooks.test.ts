import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { posterMoment } from '../src/client/render/frames.ts';
import { exportReducer } from '../src/client/video-export.ts';
import { definePlugin, resolvePlugins, resolvePluginsSync, type PluginApi, type RenderJob } from '../src/plugin/index.ts';
import type { Owned } from '../src/plugin/registry.ts';
import type { RenderedFile, RenderHooks } from '../src/plugin/types.ts';
import { createApp } from '../src/server/app.ts';
import { PosterQueue, type PosterTask } from '../src/server/posters.ts';
import { createRenderHooks } from '../src/server/render-hooks.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import type { RenderService } from '../src/server/render-routes.ts';
import { posterTag, ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const owned = (plugin: string, value: RenderHooks): Owned<RenderHooks> => ({ plugin, value });
const video = (options: RenderJob['options'] = { speed: 1, captions: false, skipInactive: true }): RenderJob => ({
  id: 'test-replay-1x-skip',
  replayId: 'test-replay',
  kind: 'video',
  options,
});
const plugin = (name: string, setup: (api: PluginApi) => void) => definePlugin({ name, setup });

describe('api.render registration', () => {
  it('keeps the hooks in plugin order and checks their shape at start', async () => {
    const registry = await resolvePlugins([
      plugin('second', (api) => api.render({ afterRender() {} })),
      definePlugin({ name: 'first', order: -1, setup: (api) => api.render({ posterAt: () => 1 }) }),
    ]);
    expect(registry.render.map((entry) => entry.plugin)).toEqual(['first', 'second']);
    const bad = (hooks: unknown) => resolvePlugins([plugin('bad', (api) => api.render(hooks as RenderHooks))]);
    await expect(bad({})).rejects.toMatchObject({ code: 'invalid-registration' });
    await expect(bad({ posterAt: 5 })).rejects.toThrow(/render.posterAt must be a function/);
    await expect(bad({ onRender() {} })).rejects.toThrow(/unknown hook "onRender"/);
  });
});

describe('posterAt', () => {
  const bundle = replay();
  const chooser = (hooks: Owned<RenderHooks>[], purposePoster?: (purpose: string | undefined) => 'first-error' | undefined) => {
    const loads: string[] = [];
    const lines: string[] = [];
    const choose = createRenderHooks(hooks, (line) => lines.push(line)).posterChooser({
      purpose: async () => 'triage',
      purposePoster,
      load: async (id) => {
        loads.push(id);
        return bundle;
      },
    });
    return { choose: choose!, loads, lines };
  };

  it('takes the first number in plugin order, then the purpose setting, then the default', async () => {
    const seen: string[] = [];
    const { choose } = chooser(
      [
        owned('a', {
          posterAt: (_bundle, { purpose }) => {
            seen.push(`a:${purpose}`);
            return undefined;
          },
        }),
        owned('b', {
          posterAt: () => {
            seen.push('b');
            return 1234;
          },
        }),
        owned('c', {
          posterAt: () => {
            seen.push('c');
            return 99;
          },
        }),
      ],
      () => 'first-error',
    );
    await expect(choose('test-replay')).resolves.toBe(1234);
    expect(seen).toEqual(['a:triage', 'b']);

    await expect(chooser([owned('a', { posterAt: () => undefined })], () => 'first-error').choose('x')).resolves.toBe('first-error');
    await expect(chooser([owned('a', { posterAt: () => undefined })]).choose('x')).resolves.toBeUndefined();
  });

  it('is the purpose setting alone without hooks (no bundle read), and nothing at all without either', async () => {
    const { choose, loads } = chooser([], () => 'first-error');
    await expect(choose('test-replay')).resolves.toBe('first-error');
    expect(loads).toEqual([]);
    expect(createRenderHooks([]).posterChooser({ purpose: async () => undefined, load: async () => bundle })).toBeUndefined();
  });

  it('skips a hook that throws or answers something that is not a time, and remembers the answer per replay', async () => {
    const { choose, loads, lines } = chooser(
      [
        owned('broken', {
          posterAt: () => {
            throw new Error('boom');
          },
        }),
        owned('odd', { posterAt: () => Number.NaN }),
        owned('negative', { posterAt: () => -5 }),
        owned('fine', { posterAt: async () => 700 }),
      ],
      () => 'first-error',
    );
    await expect(choose('test-replay')).resolves.toBe(700);
    await expect(choose('test-replay')).resolves.toBe(700);
    expect(loads).toEqual(['test-replay']);
    expect(lines).toEqual([
      'plugin broken: posterAt failed: boom',
      'plugin odd: posterAt must return a time in ms (>= 0) or undefined; got NaN',
      'plugin negative: posterAt must return a time in ms (>= 0) or undefined; got -5',
    ]);
  });

  it('names the moment in the poster key, so a changed choice is a new file', () => {
    const store = new ReplayStore(join(tmpdir(), 'replays-render-hooks-keys'), join(tmpdir(), 'replays-render-hooks-samples'));
    expect(store.posterKey('abc')).toBe('abc/poster.v2.jpg');
    expect(store.posterKey('abc', 'middle-step')).toBe('abc/poster.v2.jpg');
    expect(store.posterKey('abc', 'first-error')).toBe('abc/poster.v2-first-error.jpg');
    expect(store.posterKey('abc', 1234.4)).toBe('abc/poster.v2-t1234.jpg');
    expect(posterTag(-3)).toBe('t0');
  });

  it('seeks the render page to a hook time, clamped to the replay', () => {
    const base = { stepTimes: [1000, 5000, 9000], snapshotTimes: [0], duration: 10_000, errorTimes: [3000] };
    expect(posterMoment({ ...base, at: 2500, moment: 'first-error' })).toBe(2500);
    expect(posterMoment({ ...base, at: 50_000 })).toBe(10_000);
    expect(posterMoment({ ...base, at: 0 })).toBe(300);
  });
});

describe('beforeRender', () => {
  it('runs in plugin order and stops at the first veto, or at a hook that throws', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const runner = createRenderHooks(
      [
        owned('a', { beforeRender: () => void calls.push('a') }),
        owned('b', {
          beforeRender: () => {
            calls.push('b');
            return false;
          },
        }),
        owned('c', { beforeRender: () => void calls.push('c') }),
      ],
      (line) => lines.push(line),
    );
    await expect(runner.beforeRender(video())).resolves.toEqual({ ok: false, plugin: 'b', error: 'this export is not allowed here' });
    expect(calls).toEqual(['a', 'b']);

    const throwing = createRenderHooks(
      [
        owned('x', {
          beforeRender: () => {
            throw new Error('policy service down');
          },
        }),
      ],
      (line) => lines.push(line),
    );
    await expect(throwing.beforeRender(video())).resolves.toMatchObject({ ok: false, plugin: 'x', error: 'the export check failed' });
    expect(lines).toEqual(['plugin x: beforeRender failed: policy service down']);
  });

  it('applies only whitelisted, valid option changes; later hooks see earlier changes', async () => {
    const lines: string[] = [];
    let seen: RenderJob | undefined;
    const runner = createRenderHooks(
      [
        owned('a', { beforeRender: () => ({ speed: 2, fps: 60, edits: '' }) as never }),
        owned('b', { beforeRender: () => ({ captions: 'yes', speed: 3 }) as never }),
        owned('c', {
          beforeRender: (job) => {
            seen = job;
            return { skipInactive: false };
          },
        }),
      ],
      (line) => lines.push(line),
    );
    await expect(runner.beforeRender(video())).resolves.toEqual({ ok: true, options: { speed: 2, captions: false, skipInactive: false } });
    expect(seen?.options).toEqual({ speed: 2, captions: false, skipInactive: true });
    expect(Object.isFrozen(seen) && Object.isFrozen(seen?.options)).toBe(true);
    expect(lines).toEqual([
      'plugin a: beforeRender: video jobs have no option "fps"; ignored',
      'plugin a: beforeRender: video jobs have no option "edits"; ignored',
      'plugin b: beforeRender: captions cannot be "yes"; ignored',
      'plugin b: beforeRender: speed cannot be 3; ignored',
    ]);
    // Logged once, not on every status poll.
    await runner.beforeRender(video());
    expect(lines).toHaveLength(4);
  });

  it('ignores option changes for list media', async () => {
    const runner = createRenderHooks([owned('a', { beforeRender: () => ({ speed: 2 }) })], () => undefined);
    await expect(runner.beforeRender({ id: 'r-poster', replayId: 'r', kind: 'poster', options: {} })).resolves.toEqual({
      ok: true,
      options: {},
    });
  });
});

describe('afterRender', () => {
  it('calls every hook in order even when one throws', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const runner = createRenderHooks(
      [
        owned('a', {
          afterRender: () => {
            calls.push('a');
            throw new Error('cdn down');
          },
        }),
        owned('b', { afterRender: (job, file) => void calls.push(`b:${job.kind}:${file.bytes}`) }),
      ],
      (line) => lines.push(line),
    );
    await runner.afterRender(video(), { file: '/tmp/x.mp4', key: 'r/x.mp4', contentType: 'video/mp4', bytes: 9 });
    expect(calls).toEqual(['a', 'b:video:9']);
    expect(lines).toEqual(['plugin a: afterRender failed: cdn down']);
  });

  it('sees the stored MP4 and the requester; a throwing hook leaves the job done', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-render-hooks-'));
    const files: Array<{ job: RenderJob; file: RenderedFile; content: string }> = [];
    const lines: string[] = [];
    const queue = new RenderQueue({
      dataDir: root,
      runner: async (task) => writeFile(task.output, 'mp4-bytes'),
      log: (line) => lines.push(line),
      afterRender: async (job, file) => {
        files.push({ job, file, content: await readFile(file.file, 'utf8') });
        throw new Error('notify failed');
      },
    });
    const identity = { id: 'ada', email: 'ada@example.com' };
    await queue.enqueue('test-replay', 2, { captions: true }, { identity });
    await queue.settled('test-replay', 2, { captions: true });
    await expect(queue.status('test-replay', 2, { captions: true })).resolves.toMatchObject({ status: 'done', size: 9 });
    expect(files).toEqual([
      {
        job: {
          id: 'test-replay-2x-skip-cc',
          replayId: 'test-replay',
          kind: 'video',
          options: { speed: 2, captions: true, skipInactive: true },
          identity,
        },
        file: expect.objectContaining({ key: 'test-replay/rendered-2x-skip-cc.mp4', contentType: 'video/mp4', bytes: 9 }) as RenderedFile,
        content: 'mp4-bytes',
      },
    ]);
    expect(lines.some((line) => line.includes('afterRender failed: notify failed'))).toBe(true);
  });
});

/** A poster queue on a real store, wired to `hooks` as start.ts wires the plugins'. */
async function posterQueue(hooks: Owned<RenderHooks>[]) {
  const root = await mkdtemp(join(tmpdir(), 'replays-render-hooks-posters-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const tasks: PosterTask[] = [];
  const runner = createRenderHooks(hooks, () => undefined);
  const posters = new PosterQueue({
    storage: store.storage,
    key: (id, choice) => store.posterKey(id, choice),
    posterAt: runner.posterChooser({ purpose: async () => undefined, load: (id) => store.load(id) }),
    beforeRender: runner.beforeRender,
    afterRender: runner.afterRender,
    open: { key: (id) => store.openStillKey(id), runner: async () => undefined },
    runner: async (task) => {
      tasks.push(task);
      await writeFile(task.output, 'jpeg');
      await writeFile(`${task.output}.open.jpg`, 'open');
    },
  });
  return { store, posters, tasks };
}

/** An app with one plugin registering `hooks`, and a render queue whose runner writes a fake MP4. */
async function startApp(hooks: RenderHooks) {
  const root = await mkdtemp(join(tmpdir(), 'replays-render-hooks-routes-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await store.save(replay());
  const clientDir = join(root, 'client');
  await mkdir(clientDir, { recursive: true });
  const queue = new RenderQueue({ dataDir: store.dataDir, runner: async (task) => writeFile(task.output, 'mp4') });
  const render: RenderService = {
    tools: { available: true, chromiumPath: '/bin/chromium', ffmpegPath: 'ffmpeg' },
    queue,
    token: 'a'.repeat(43),
    clientDir,
    maxDurationMs: 60_000,
  };
  const handle = createApp({
    ...appDefaults(),
    store,
    clientDir,
    render,
    plugins: resolvePluginsSync([plugin('policy', (api) => api.render(hooks))]),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, queue, endpoint: `${origin}/api/replays/test-replay/render` };
}
const post = (url: string, origin: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

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
    expect(done).toEqual(['poster:test-replay/poster.v2-t400.jpg', 'open:test-replay/open.v1.jpg']);
  });

  it('fails a vetoed job without running it', async () => {
    const { posters, tasks } = await posterQueue([owned('deny', { beforeRender: (job) => (job.kind === 'poster' ? false : undefined) })]);
    await posters.request('test-replay');
    await posters.settled('test-replay');
    expect(tasks).toEqual([]);
    await expect(posters.request('test-replay')).resolves.toBe('failed');
  });
});

describe('the render routes with beforeRender', () => {
  it('refuses a vetoed export with a clear status: 403 to start it, 200 to the status probe', async () => {
    const { origin, endpoint } = await startApp({ beforeRender: (job) => (job.options.captions ? false : undefined) });
    const refused = await post(endpoint, origin, { speed: 1, captions: true });
    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toEqual({ status: 'refused', error: 'this export is not allowed here' });
    const probe = await fetch(`${endpoint}?captions=1`);
    expect(probe.status).toBe(200);
    await expect(probe.json()).resolves.toMatchObject({ status: 'refused' });
    expect((await post(endpoint, origin, { speed: 1 })).status).toBe(202);
  });

  it('renders the adjusted variant, and status and download requests map to the same one', async () => {
    const seen: RenderJob[] = [];
    const { origin, endpoint, queue } = await startApp({
      beforeRender: (job) => {
        seen.push(job);
        return { speed: 2 };
      },
    });
    const started = await post(endpoint, origin, { speed: 1 });
    await expect(started.json()).resolves.toMatchObject({ jobId: 'test-replay-2x-skip' });
    await queue.settled('test-replay', 2);
    await expect((await fetch(`${endpoint}?speed=1`)).json()).resolves.toMatchObject({ status: 'done', jobId: 'test-replay-2x-skip' });
    const file = await fetch(`${endpoint}/file?speed=1`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('2x');
    expect(seen[0]).toMatchObject({
      id: 'test-replay-1x-skip',
      replayId: 'test-replay',
      kind: 'video',
      identity: { id: expect.any(String) as string },
    });
  });

  it('turns a refusal into an error message in the viewer', () => {
    expect(
      exportReducer({ kind: 'queued' }, { type: 'job', job: { status: 'refused', error: 'exports are off for this replay' } }),
    ).toEqual({
      kind: 'error',
      message: 'Exports are off for this replay.',
    });
  });
});
