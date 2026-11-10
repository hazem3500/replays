import { mkdtemp, readdir, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { EMPTY_COMMENTS } from '../src/shared/comments.ts';
import { assertReplayPeople } from '../src/shared/people.ts';
import { parseManifest, parsePluginFile, starterPlugin } from '../src/shared/malleable.ts';
import { UserPluginStore } from '../src/server/malleable-store.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';
import { ReplayStore } from '../src/server/store.ts';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash-encode.ts';
import { replay } from './fixtures.ts';

// docs/formats/*.schema.json are the documented, stable formats shared by tools and plugins. These tests keep them true:
// real files the app writes must validate, and the schemas must reject what the app rejects.
const dir = join(import.meta.dirname, '../docs/formats');

async function ajv() {
  const instance = new Ajv2020.default({ strict: false, allErrors: true });
  (addFormats as unknown as { default: (a: unknown) => void }).default(instance);
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.schema.json')))
    instance.addSchema(JSON.parse(await readFile(join(dir, file), 'utf8')));
  return instance;
}
const id = (name: string) => `https://github.com/hazem3500/replays/docs/formats/${name}.schema.json`;

async function validator(name: string) {
  const instance = await ajv();
  const validate = instance.getSchema(id(name));
  if (!validate) throw new Error(`no schema ${name}`);
  return (value: unknown) => ({ ok: validate(value) as boolean, errors: instance.errorsText(validate.errors) });
}

describe('docs/formats', () => {
  it('validates sandbox tracks and context sections with the manifest schema', async () => {
    const check = await validator('plugin-manifest');
    const manifest = parseManifest({
      ...starterPlugin().manifest,
      contributes: { tracks: [{ id: 'events', label: 'Events' }], contextSections: [{ id: 'release', label: 'Release' }] },
    });
    expect(check(manifest).errors).toBe('No errors');
    expect(check({ ...manifest, contributes: { tracks: [{ id: 'Bad Id', label: 'Events' }] } }).ok).toBe(false);
  });
  it('every schema compiles', async () => {
    const instance = await ajv();
    const files = (await readdir(dir)).filter((name) => name.endsWith('.schema.json'));
    expect(files.sort()).toEqual([
      'bulk-trash-request.schema.json',
      'bulk-trash-result.schema.json',
      'comments.schema.json',
      'context.schema.json',
      'data-storage.schema.json',
      'edits.schema.json',
      'expired-replay.schema.json',
      'plugin-manifest.schema.json',
      'replay-summary.schema.json',
      'replay.schema.json',
      'suite-plan.schema.json',
      'user-plugin-history.schema.json',
      'user-plugin.schema.json',
    ]);
    for (const file of files) expect(instance.getSchema(id(file.replace('.schema.json', '')))).toBeTruthy();
  });

  it('the sample suite plan validates, and the schema rejects what the CLI rejects', async () => {
    const check = await validator('suite-plan');
    const sample = JSON.parse(await readFile(join(import.meta.dirname, '../sample/suite-plan.json'), 'utf8'));
    expect(check(sample).errors).toBe('No errors');
    const run = { id: 'a', title: 'A', url: 'https://example.com/', steps: [] };
    expect(check({ id: 'p', title: 'P', runs: [run] }).ok).toBe(true);
    expect(check({ id: 'p', title: 'P', runs: [{ ...run, steps: [{ kind: 'click' }] }] }).ok).toBe(false);
    expect(check({ id: 'p', title: 'P', runs: [{ ...run, steps: [{ kind: 'eval' }] }] }).ok).toBe(false);
    expect(check({ id: 'P', title: 'P', runs: [run] }).ok).toBe(false);
    expect(check({ id: 'p', title: 'P', runs: [] }).ok).toBe(false);
  });

  it('the sample replays validate as replay bundles', async () => {
    const check = await validator('replay');
    for (const file of ['demo-shop.json', 'human-demo.json']) {
      const bundle = JSON.parse(await readFile(join(import.meta.dirname, '../sample', file), 'utf8'));
      const result = check(bundle);
      expect(result.errors).toBe('No errors');
      expect(result.ok).toBe(true);
    }
    expect(check({ meta: {}, events: [], console: [], network: [], steps: [] }).ok).toBe(false);
  });

  it('the summaries the store lists validate, with and without a poster ThumbHash', async () => {
    const check = await validator('replay-summary');
    const root = await mkdtemp(join(tmpdir(), 'replays-formats-'));
    try {
      const store = new ReplayStore(join(root, 'data'), join(import.meta.dirname, '../sample'));
      const plain = await store.summary('demo-shop');
      expect(check(plain).errors).toBe('No errors');
      await store.save(replay('summary-format'));
      await store.setThumbHash('summary-format', thumbHashToBase64(rgbaToThumbHash(4, 3, new Uint8Array(48).fill(200))));
      const hashed = await store.summary('summary-format');
      expect(hashed?.thumbhash).toBeDefined();
      expect(check(hashed).errors).toBe('No errors');
      expect(check({ ...hashed, thumbhash: 'url(x)' }).ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('the records retention leaves of removed replays validate', async () => {
    const check = await validator('expired-replay');
    const root = await mkdtemp(join(tmpdir(), 'replays-formats-'));
    try {
      const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), { days: 1 });
      await store.save(replay('removed-replay'));
      const old = new Date(Date.now() - 3 * 86_400_000);
      await utimes(join(root, 'data', 'removed-replay', 'replay.json'), old, old);
      await store.prune();
      const [record] = (await store.expiredReplays()).records;
      expect(check(record).errors).toBe('No errors');
      expect(check({ ...record, retentionDays: 'forever' }).ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('meta.people: what the server accepts validates, what it refuses does not', async () => {
    const check = await validator('replay');
    const bundle = JSON.parse(await readFile(join(import.meta.dirname, '../sample/demo-shop.json'), 'utf8'));
    const withPeople = (people: unknown) => ({ ...bundle, meta: { ...bundle.meta, people } });
    const good = [
      { role: 'reviewer', email: 'ada@example.com', name: 'Ada', handles: { github: 'ada' } },
      { role: 'requester', handles: { chat: 'U123' } },
    ];
    assertReplayPeople(good);
    expect(check(withPeople(good)).errors).toBe('No errors');
    for (const bad of [
      [{ role: 'reviewer' }],
      [{ role: 'Reviewer', email: 'a@example.com' }],
      [{ role: 'x', email: 'a@example.com', extra: 1 }],
    ]) {
      expect(() => assertReplayPeople(bad)).toThrow('replay.meta.people[0]');
      expect(check(withPeople(bad)).ok).toBe(false);
    }
  });

  it('comments the app writes validate', async () => {
    const check = await validator('comments');
    expect(check(EMPTY_COMMENTS).ok).toBe(true);
    const file = {
      version: 1,
      comments: [
        { id: 'c-abc123', at: 1200, body: 'hello', author: { id: 'ada@example.com', name: 'Ada' }, createdAt: '2026-01-01T00:00:00.000Z' },
        {
          id: 'c-abc124',
          parentId: 'c-abc123',
          body: '',
          emoji: '🐛',
          author: { id: 'x', anonymous: true },
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    };
    expect(check(file).errors).toBe('No errors');
    expect(check({ ...file, comments: [{ ...file.comments[0], id: 'nope' }] }).ok).toBe(false);
  });

  it('edit lists validate', async () => {
    const check = await validator('edits');
    const edits = {
      version: 1,
      trim: { start: 0, end: 9000 },
      cuts: [{ id: 'wait-1', from: 2000, to: 3500, label: 'wait' }],
      zooms: [{ id: 'z1', from: 100, to: 900, scale: 1.8, x: 0.5, y: 0.5 }],
      speeds: [{ id: 's1', from: 1000, to: 2000, rate: 4 }],
      blurs: [{ id: 'b1', from: 0, to: 500, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
      captions: [{ id: 'c1', from: 0, to: 500, text: 'Hello' }],
      revision: 3,
      updatedBy: 'ada',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(check(edits).errors).toBe('No errors');
    expect(check({ ...edits, speeds: [{ id: 's1', from: 1, to: 2, rate: 20 }] }).ok).toBe(false);
  });

  it('the shipped example plugins are valid plugin files', async () => {
    const check = await validator('user-plugin');
    const folder = join(import.meta.dirname, '../examples/malleable');
    const files = (await readdir(folder)).filter((name) => name.endsWith('.replays-plugin.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const name of files) {
      const parsed = JSON.parse(await readFile(join(folder, name), 'utf8'));
      expect(check(parsed).errors).toBe('No errors');
      expect(parsePluginFile(parsed).manifest.id).toMatch(/^[a-z]/);
    }
  });

  it('plugin files and the stored history validate, and what the store writes matches', async () => {
    const file = await validator('user-plugin');
    const history = await validator('user-plugin-history');
    const manifest = await validator('plugin-manifest');
    const starter = starterPlugin();
    expect(manifest(starter.manifest).errors).toBe('No errors');
    expect(file({ format: 'replays-user-plugin/1', ...starter }).errors).toBe('No errors');
    expect(file({ format: 'replays-user-plugin/1', manifest: { ...starter.manifest, permissions: ['network'] }, source: 'x' }).ok).toBe(
      false,
    );

    const storage = new MemoryStorage();
    const store = new UserPluginStore(storage);
    await store.save('user', 'ada', 'my-tab', { ...starter, message: 'first', by: 'Ada', baseVersion: 0 });
    await store.save('user', 'ada', 'my-tab', {
      ...starter,
      source: `${starter.source}// 2\n`,
      message: 'second',
      by: 'Ada',
      baseVersion: 1,
    });
    const stored = await store.history('user', 'ada', 'my-tab');
    expect(history(stored).errors).toBe('No errors');
    expect(file({ format: 'replays-user-plugin/1', ...starter, versions: stored!.versions }).errors).toBe('No errors');
  });
});
