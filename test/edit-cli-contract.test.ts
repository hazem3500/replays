import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeEdit } from '../src/edit/cli.ts';
import { EditClient } from '../src/edit/client.ts';
import { createApp } from '../src/server/app.ts';
import { RenderQueue } from '../src/server/render-queue.ts';
import type { RenderService } from '../src/server/render-routes.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

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

async function boot(options: { beta?: boolean; editing?: boolean; render?: boolean } = {}) {
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

describe('replays edit against the real edits routes', () => {
  it('shows an unedited replay with its numbered steps', async () => {
    const { run, origin } = await boot();
    const shown = await run(['show', '--json']);
    expect(shown).toMatchObject({ success: true, id: 'edit-me', link: `${origin}/r/edit-me`, revision: 0, duration: 30_000 });
    expect(shown.steps).toEqual([
      expect.objectContaining({ index: 1, at: 0, time: '0.0s', label: 'Open example.com', key: '0' }),
      expect.objectContaining({ index: 2, at: 4000, label: 'Clicked “Save”' }),
      expect.objectContaining({ index: 3, at: 12_300, kind: 'wait', key: '12300' }),
      expect.objectContaining({ index: 4, at: 20_000 }),
    ]);
  });

  it('adds, lists and removes each kind of edit, saving revisions as it goes', async () => {
    const { run, store } = await boot();
    await run(['cut', '--from', '10s', '--to', '18s', '--label', 'boring']);
    await run(['speed', '--from', '20s', '--to', 'end', '--rate', '4']);
    await run(['zoom', '--from', '3s', '--to', '6s', '--rect', '0.25,0.25,0.5,0.5']);
    await run(['blur', '--from', '3s', '--to', '6s', '--rect', '10%,10%,20%,20%']);
    await run(['remove', '--from', '7s', '--to', '8s', '--rect', '720px,45px,144px,90px']);
    await run(['caption', 'add', '--from', '3s', '--to', '6s', 'Signing in']);
    await run(['highlight', 'add', '--at', '14.9s', 'Look here']);
    await run(['trim', '--from', '1s', '--to', '29s']);
    await run(['cursor', '--appearance', 'ring', '--size', '1.5']);
    const { edits, version } = await store.readEdits('edit-me');
    expect(version).toBeDefined();
    expect(edits).toMatchObject({
      revision: 9,
      trim: { start: 1000, end: 29_000 },
      cuts: [{ from: 10_000, to: 18_000, label: 'boring' }],
      speeds: [{ from: 20_000, to: 30_000, rate: 4 }],
      zooms: [{ from: 3000, to: 6000, scale: 2, x: 0.5, y: 0.5 }],
      captions: [{ from: 3000, to: 6000, text: 'Signing in' }],
      highlights: [{ kind: 'point', at: 14_900, label: 'Look here' }],
      cursor: { appearance: 'ring', size: 1.5 },
    });
    expect(edits.blurs).toEqual([
      expect.objectContaining({ from: 3000, to: 6000, x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
      expect.objectContaining({ from: 7000, to: 8000, x: 0.5, y: 0.05, width: 0.1, height: 0.1, style: 'redact' }),
    ]);

    const shown = await run(['show', '--json']);
    expect(shown.revision).toBe(9);

    for (const [command, n] of [
      [['cut'], '1'],
      [['speed'], '1'],
      [['zoom'], '1'],
      [['blur'], '2'],
      [['blur'], '1'],
      [['caption'], '1'],
      [['highlight'], '1'],
    ] as const)
      await run([...command, 'rm', n]);
    await run(['trim', '--reset']);
    await run(['cursor', '--reset']);
    expect((await store.readEdits('edit-me')).edits).toMatchObject({ cuts: [], revision: 18 });
    const left = (await store.readEdits('edit-me')).edits;
    expect(Object.keys(left).sort()).toEqual(['cuts', 'revision', 'updatedAt', 'updatedBy', 'version']);
  });

  it('reports no change and does not save when there is nothing to do', async () => {
    const { run, store } = await boot();
    const result = await run(['trim', '--reset']);
    expect(result).toMatchObject({ changed: false, revision: 0, changes: { added: [], removed: [], changed: [] } });
    expect((await store.readEdits('edit-me')).version).toBeUndefined();
    await run(['cut', 'waits']);
    await expect(run(['cut', 'waits'])).rejects.toThrow('already cut');
  });

  it('cuts waits above a threshold, as the editor does', async () => {
    const { run, store } = await boot();
    await expect(run(['cut', 'waits', '--min', '30s'])).rejects.toThrow('no wait is long enough');
    const result = await run(['cut', 'waits', '--min', '5s']);
    expect(result.changes).toEqual({ added: ['cut 12.7s–19.6s “Waited for the build”'], removed: [], changed: [] });
    expect((await store.readEdits('edit-me')).edits.cuts).toEqual([
      { id: 'wait-2', from: 12_700, to: 19_600, label: 'Waited for the build' },
    ]);
  });

  it('edits and removes captions by number', async () => {
    const { run, store } = await boot();
    await run(['caption', 'add', '--from', '1s', '--to', '2s', 'One']);
    await run(['caption', 'add', '--from', '3s', '--to', '4s', 'Two']);
    await run(['caption', 'edit', '2', '--to', '5s', 'Second']);
    expect((await store.readEdits('edit-me')).edits.captions).toEqual([
      expect.objectContaining({ text: 'One', from: 1000, to: 2000 }),
      expect.objectContaining({ text: 'Second', from: 3000, to: 5000 }),
    ]);
    await run(['caption', 'rm', '1']);
    expect((await store.readEdits('edit-me')).edits.captions).toHaveLength(1);
    await expect(run(['caption', 'rm', '4'])).rejects.toThrow('there is no caption 4; the replay has 1');
  });

  it('pushes validated edits, refuses invalid ones locally and a stale file with the pull-again message', async () => {
    const { run, dir, store } = await boot();
    const file = join(dir, 'edits.json');
    await run(['cut', '--from', '10s', '--to', '18s']);
    const pulled = await run(['pull', '-o', file, '--json']);
    expect(pulled).toMatchObject({ revision: 1, file });
    const text = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(text).toMatchObject({ revision: 1, cuts: [{ id: 'cut-1' }] });
    await expect(run(['pull', '-o', file])).rejects.toThrow('already exists');

    const edited = { ...text, captions: [{ id: 'caption-1', from: 1000, to: 2000, text: 'Hello' }] };
    await writeFile(file, JSON.stringify(edited));
    const dry = await run(['push', file, '--dry-run']);
    expect(dry).toMatchObject({ dryRun: true, changed: true, changes: { added: ['caption 1.0s–2.0s “Hello”'] } });
    expect((await store.readEdits('edit-me')).edits.revision).toBe(1);
    const pushed = await run(['push', file]);
    expect(pushed).toMatchObject({ changed: true, revision: 2 });

    await writeFile(file, JSON.stringify({ ...edited, cuts: [{ id: 'cut-1', from: 10_000, to: 99_000 }] }));
    await expect(run(['push', file, '--force'])).rejects.toThrow('after the end of the replay');
    await writeFile(file, JSON.stringify({ ...edited, speeds: [{ id: 's', from: 0, to: 1000, rate: 99 }] }));
    await expect(run(['push', file])).rejects.toThrow('rate must be a number from 1 to 16');

    await writeFile(file, JSON.stringify({ ...edited, highlights: [{ id: 'h', kind: 'point', at: 5 }] }));
    await expect(run(['push', file])).rejects.toThrow('run `replays edit <id> pull` again');
    expect((await run(['push', file, '--force'])).revision).toBe(3);
    expect((await store.readEdits('edit-me')).edits.highlights).toEqual([{ id: 'h', kind: 'point', at: 5 }]);
  });

  it('answers a conflict with the pull-again message when the retry loses too', async () => {
    const { origin, link } = await boot();
    const client = new EditClient({ server: origin, id: 'edit-me', headers: async () => ({}) });
    const first = await client.getEdits();
    const saved = await client.putEdits({ version: 1, cuts: [{ id: 'c', from: 1000, to: 2000 }] }, first.etag);
    expect(saved.status).toBe('saved');
    const stale = await client.putEdits({ version: 1, cuts: [{ id: 'c', from: 1000, to: 3000 }] }, first.etag);
    expect(stale).toMatchObject({ status: 'conflict', current: { edits: { revision: 1 } } });
    expect(link).toContain('/r/edit-me');
  });

  it('renames steps for people on the replay and explains the refusal to anyone else', async () => {
    const { run, headerFile, store } = await boot();
    const stranger = await headerFile('bob@example.com');
    await expect(run(['rename', '3', 'Wait for the build', '--header-file', stranger])).rejects.toThrow(
      'only the people listed on this replay (matched by your sign-in email) or an admin can rename steps',
    );
    await run(['cut', '--from', '1s', '--to', '2s', '--header-file', stranger]);

    const ada = await headerFile('ada@example.com');
    const named = await run(['rename', '12.3s', 'Waited for CI', '--header-file', ada]);
    expect(named.changes).toMatchObject({ added: ['step name at 12300 ms “Waited for CI”'] });
    expect((await store.readEdits('edit-me')).edits.stepNames).toEqual({ '12300': 'Waited for CI' });
    const shown = await run(['show', '--json', '--header-file', ada]);
    expect(shown.steps).toEqual(expect.arrayContaining([expect.objectContaining({ index: 3, label: 'Waited for CI', renamed: true })]));
    await run(['rename', '#3', '--reset', '--header-file', ada]);
    expect((await store.readEdits('edit-me')).edits.stepNames).toBeUndefined();
    await expect(run(['rename', '9', 'x', '--header-file', ada])).rejects.toThrow('there is no step 9; this replay has 4');
  });

  it('keeps invalid edits off the server with the validator message', async () => {
    const { run, store } = await boot();
    await expect(run(['cut', '--from', '10s', '--to', '10.05s'])).rejects.toThrow('must be at least 100 ms long');
    await expect(run(['cut', '--from', '10s', '--to', '40s'])).rejects.toThrow('after the end of the replay');
    await run(['speed', '--from', '1s', '--to', '5s', '--rate', '2']);
    await expect(run(['speed', '--from', '4s', '--to', '8s', '--rate', '2'])).rejects.toThrow('must not overlap');
    await expect(run(['speed', '--from', '1s', '--to', '5s', '--rate', '17'])).rejects.toThrow('--rate must be from 1 to 16');
    await expect(run(['blur', '--from', '1s', '--to', '2s', '--selector', '#x'])).rejects.toThrow('selector-based regions are not part');
    await expect(run(['cut', '--from', '1s'])).rejects.toThrow('cut needs --to');
    await expect(run(['cut', '--from', '1', '--to', '2s'])).rejects.toThrow('is not a time');
    expect((await store.readEdits('edit-me')).edits.revision).toBe(1);
  });

  it('says undo is unavailable', async () => {
    const { run } = await boot();
    await expect(run(['undo'])).rejects.toThrow('the server keeps only the current edit list');
  });

  it('says who to ask when the editor is off or editing is disabled', async () => {
    const off = await boot({ beta: false });
    await expect(off.run(['show'])).rejects.toThrow('has the replay editor turned off');
    const disabled = await boot({ editing: false });
    await expect(disabled.run(['cut', '--from', '1s', '--to', '2s'])).rejects.toThrow('editing is turned off');
    expect((await disabled.run(['show', '--json'])).revision).toBe(0);
  });

  it('says when the replay does not exist', async () => {
    const { origin, configPath } = await boot();
    await expect(executeEdit([`${origin}/r/nope`, 'show'], {}, { configPath })).rejects.toThrow('no replay nope');
  });

  it('refuses a replay on any server but the one a wrapper approved', async () => {
    const { origin, configPath } = await boot();
    await expect(
      executeEdit(['https://other.example.com/r/edit-me', 'show'], {}, { configPath, trustedServerUrl: origin }),
    ).rejects.toThrow(`only edits replays on ${origin}`);
    const ok = await executeEdit(['edit-me', 'show', '--json'], {}, { configPath, trustedServerUrl: origin });
    expect(ok.json).toMatchObject({ success: true, id: 'edit-me' });
  });

  it('exports the edited video and downloads it', async () => {
    const { run, dir, runs } = await boot({ render: true });
    await run(['cut', '--from', '10s', '--to', '18s']);
    const file = join(dir, 'out.mp4');
    const result = await run(['export', '--speed', '2', '--captions', '-o', file]);
    expect(result).toMatchObject({ success: true, file, speed: 2, captions: true, skipInactive: true, edited: true });
    expect(await readFile(file, 'utf8')).toBe('fake-mp4');
    expect(runs).toEqual([{ speed: 2, captions: true, edits: expect.stringMatching(/^[a-z0-9]+$/) }]);
    await expect(run(['export', '-o', file])).rejects.toThrow('already exists');
    await expect(run(['export', '--speed', '3', '-o', join(dir, 'x.mp4')])).rejects.toThrow('--speed must be one of');
  });

  it('explains an export on a server that cannot render', async () => {
    const { run, dir } = await boot();
    await expect(run(['export', '-o', join(dir, 'x.mp4')])).rejects.toThrow('cannot render videos');
  });
});
