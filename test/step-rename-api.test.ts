import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import type { Identity } from '../src/server/auth/types.ts';
import { changesStepNames, mayRenameSteps } from '../src/server/edit-permission.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const people = [
  { role: 'author', email: 'Ada@Example.com' },
  { role: 'reviewer', handles: { github: 'octocat' } },
];

describe('mayRenameSteps', () => {
  it('allows a signed-in email that matches any person, ignoring case and role', () => {
    expect(mayRenameSteps({ email: 'ada@example.com' }, people)).toBe(true);
    expect(mayRenameSteps({ email: 'ADA@example.com' }, [{ role: 'qa', email: 'ada@example.com' }])).toBe(true);
  });

  it('refuses strangers, anonymous callers and replays without people', () => {
    expect(mayRenameSteps({ email: 'bob@example.com' }, people)).toBe(false);
    expect(mayRenameSteps({}, people)).toBe(false);
    expect(mayRenameSteps({ email: 'ada@example.com' }, undefined)).toBe(false);
  });

  it('does not treat a handle as proof of identity', () => {
    expect(mayRenameSteps({ email: 'octocat@example.com' }, people)).toBe(false);
  });

  it('allows the admin role', () => {
    expect(mayRenameSteps({ email: 'root@example.com', roles: ['admin'] }, people)).toBe(true);
    expect(mayRenameSteps({ email: 'root@example.com', roles: ['viewer'] }, people)).toBe(false);
  });
});

describe('changesStepNames', () => {
  it('compares names regardless of key order and treats absent as empty', () => {
    expect(changesStepNames({ version: 1, cuts: [] }, {})).toBe(false);
    expect(changesStepNames({ stepNames: { b: 'B', a: 'A' } }, { stepNames: { a: 'A', b: 'B' } })).toBe(false);
    expect(changesStepNames({ stepNames: { '0': 'New' } }, {})).toBe(true);
    expect(changesStepNames({ version: 1, cuts: [] }, { stepNames: { '0': 'Old' } })).toBe(true);
  });
});

async function start(identity: Identity) {
  const root = await mkdtemp(join(tmpdir(), 'replays-rename-'));
  const sample = join(root, 'sample');
  await mkdir(sample);
  await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
  const store = new ReplayStore(join(root, 'data'), sample, 7);
  const bundle = replay();
  bundle.meta.people = people;
  await store.save(bundle);
  const handle = createApp({
    ...appDefaults(),
    auth: { name: 'test', authenticate: () => identity },
    beta: { editor: true, malleable: false },
    store,
    clientDir: join(root, 'client'),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const put = (body: unknown, ifMatch: string) =>
    fetch(`${origin}/api/replays/test-replay/edits`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin, 'if-match': ifMatch },
      body: JSON.stringify(body),
    });
  return { put, store };
}

const renamed = { version: 1, cuts: [], stepNames: { '0': 'Open the app' } };

describe('PUT edits with step names', () => {
  it('lets a person on the replay rename a step and stores the name', async () => {
    const { put, store } = await start({ id: 'ada', email: 'ada@example.com' });
    const saved = await put(renamed, '"e.none"');
    expect(saved.status).toBe(200);
    await expect(store.readEdits('test-replay')).resolves.toMatchObject({ edits: { stepNames: { '0': 'Open the app' }, updatedBy: 'ada' } });
  });

  it('refuses a caller who is not on the replay, and stores nothing', async () => {
    const { put, store } = await start({ id: 'bob', email: 'bob@example.com' });
    expect((await put(renamed, '"e.none"')).status).toBe(403);
    await expect(store.readEdits('test-replay')).resolves.toMatchObject({ edits: { revision: 0 } });
  });

  it('keeps other edits open to anyone who could already make them', async () => {
    const { put } = await start({ id: 'bob', email: 'bob@example.com' });
    expect((await put({ version: 1, cuts: [{ id: 'c1', from: 100, to: 300 }] }, '"e.none"')).status).toBe(200);
  });

  it('rejects empty and oversized names', async () => {
    const { put } = await start({ id: 'ada', email: 'ada@example.com' });
    expect((await put({ version: 1, cuts: [], stepNames: { '0': '   ' } }, '"e.none"')).status).toBe(400);
    expect((await put({ version: 1, cuts: [], stepNames: { '0': 'x'.repeat(121) } }, '"e.none"')).status).toBe(400);
  });
});
