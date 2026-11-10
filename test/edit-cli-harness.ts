import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeEdit } from '../src/edit/cli.ts';
import { createApp } from '../src/server/app.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import type { RenderService } from '../src/server/render-routes.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
export async function closeServers() {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
}

/** 30 s long, with a click, a wait and a second click, so every kind of target exists. */
function recording(id = 'edit-me'): ReplayBundle {
  const base = replay(id);
  return {
    ...base,
    meta: {
      ...base.meta,
      duration: 30_000,
      eventCount: 3,
      people: [{ role: 'reporter', email: 'ada@example.com' }],
    },
    events: [
      { type: 4, timestamp: 1000 },
      { type: 2, timestamp: 2000 },
      { type: 3, timestamp: 31_000 },
    ],
    steps: [
      { at: 0, kind: 'open', label: 'Open example.com', url: 'https://example.com/' },
      { at: 4000, kind: 'click', label: 'Clicked “Save”', auto: true },
      { at: 12_300, kind: 'wait', label: 'Waited for the build' },
      { at: 20_000, kind: 'click', label: 'Clicked “Done”', auto: true },
    ],
  };
}

export async function boot(options: { beta?: boolean; editing?: boolean; render?: boolean } = {}) {
  const { beta = true, editing, render = false } = options;
  const root = await mkdtemp(join(tmpdir(), 'replays-edit-cli-'));
  const sample = join(root, 'sample');
  await mkdir(sample);
  await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
  const store = new ReplayStore(join(root, 'data'), sample, 7);
  await store.save(recording());
  const clientDir = join(root, 'client');
  await mkdir(clientDir);
  const runs: Array<{ speed: number; captions: boolean; edits: string }> = [];
  const service: RenderService = {
    tools: { available: true, chromiumPath: '/bin/chromium', ffmpegPath: 'ffmpeg' },
    queue: new RenderQueue({
      dataDir: store.dataDir,
      runner: async (task) => {
        runs.push({ speed: task.speed, captions: task.captions, edits: task.edits });
        task.onProgress(0.5);
        await writeFile(task.output, 'fake-mp4');
      },
    }),
    token: 'a'.repeat(43),
    clientDir,
    maxDurationMs: 60_000,
  };
  const handle = createApp({
    ...appDefaults(),
    beta: { editor: beta, malleable: false },
    ...(editing === undefined ? {} : { editing: { enabled: editing } }),
    store,
    clientDir,
    ...(render ? { render: service } : {}),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const dir = await mkdtemp(join(tmpdir(), 'replays-edit-cli-out-'));
  const configPath = join(dir, 'config.json');
  const link = `${origin}/r/edit-me`;
  const run = (args: string[]) =>
    executeEdit([link, ...args], {}, { configPath, stderr: { write: () => true, isTTY: false } }).then((output) => output.json);
  const headerFile = async (user: string) => {
    const file = join(dir, `${user}.headers.json`);
    await writeFile(file, JSON.stringify({ 'x-dev-user': user }));
    return file;
  };
  return { origin, link, store, dir, run, headerFile, runs, configPath };
}
