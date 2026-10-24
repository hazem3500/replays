import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import translate, { translateSuite } from '../examples/migrate/translate.mjs';
import { compareStores, type MigrateProgress, migrateStore } from '../src/server/migrate.ts';
import { formatComparison, parseMigrateArgs, runMigrateCli } from '../src/server/migrate-cli.ts';
import { FsStorage, MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';
import { replay } from './fixtures.ts';

const JSON_TYPE = { contentType: 'application/json' };
const SLACK = 'https://example-team.slack.com/archives/C0123ABCD/p1700000000000100';

/** A bundle in the downstream's pre-upstream shape (see the example translator). */
function legacyBundle(id: string) {
  const { meta, ...rest } = replay(id);
  return {
    ...rest,
    meta: { ...meta, source: 'toki', purpose: 'triage', tags: ['smoke'] },
    context: {
      version: 1,
      capturedAt: '2026-10-06T00:00:00.000Z',
      app: { product: 'Example App', environment: 'staging', origin: 'https://app.example.com' },
      test: { suite: 'checkout' },
      account: { id: 7, label: 'Account 7', flags: [{ key: 'beta', state: 'enabled' }] },
      organization: { id: 3, plan: { state: 'known', name: 'pro' } },
      sources: [
        { kind: 'slack-thread', visibility: 'public', url: SLACK, id: 'T1', capturedAt: '2026-10-06T00:00:00.000Z' },
        {
          kind: 'github-pr',
          url: 'https://github.com/acme/web/pull/12',
          repository: 'acme/web',
          number: 12,
          capturedAt: '2026-10-06T00:00:00.000Z',
        },
      ],
    },
  };
}

const legacySuite = {
  version: 1,
  id: 'suite-one',
  title: 'Review of acme/web#12',
  createdAt: '2026-10-06T00:00:00.000Z',
  review: {
    kind: 'github-pr',
    url: 'https://github.com/acme/web/pull/12',
    repository: 'acme/web',
    number: 12,
    capturedAt: '2026-10-06T00:00:00.000Z',
  },
  people: [{ role: 'pr-author', github: 'octocat' }],
  runs: [],
};

/** A data directory as the old server left it. */
async function legacyStore() {
  const dir = await mkdtemp(join(tmpdir(), 'replays-migrate-'));
  const source = new FsStorage(dir);
  const write = (key: string, value: unknown) => source.write(key, typeof value === 'string' ? value : JSON.stringify(value), JSON_TYPE);
  await write('old-one/replay.json', legacyBundle('old-one'));
  await write('old-one/meta.json', { id: 'old-one', stale: true });
  await write('old-one/comments.json', { version: 1, comments: [] });
  await write('old-one/edits.json', { version: 1, revision: 1 });
  await write('old-one/keep.json', { by: 'someone@example.com', at: '2026-10-07T00:00:00.000Z' });
  await source.write('old-one/poster.v2.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  await write('human-one/replay.json', { ...replay('human-one'), meta: { ...replay('human-one').meta, source: 'human' } });
  // Not a recording (one event): reported, never written.
  await write('broken/replay.json', { ...replay('broken'), events: [{ type: 4, timestamp: 1 }] });
  await write('broken/comments.json', { version: 1, comments: [] });
  // A committed sample's comments, and a plugin's own data.
  await write('sample-one/comments.json', { version: 1, comments: [] });
  await write('_malleable/w/tool.json', { id: 'tool' });
  await write('_suites/suite-one.json', legacySuite);
  await write('_suites/suite-one.keep.json', { by: 'someone@example.com', at: '2026-10-07T00:00:00.000Z' });
  await write('old-one/replay.json.123.tmp', 'partial');
  return { dir, source };
}

const keysOf = async (storage: MemoryStorage | FsStorage) => (await storage.list()).map((object) => object.key).sort();

describe('migrateStore', () => {
  it('converts an fs store into memory with the example translator', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    const progress = vi.fn<(progress: MigrateProgress) => void>();
    const report = await migrateStore({ from: source, to: target, translate, translateSuite, onProgress: progress });

    expect(report.failed).toEqual([{ id: 'broken', kind: 'replay', reason: 'replay.events must contain an rrweb recording' }]);
    expect(report.converted.map(({ id, kind, translated }) => ({ id, kind, translated }))).toEqual([
      { id: '_malleable', kind: 'objects', translated: false },
      { id: 'human-one', kind: 'replay', translated: false },
      { id: 'old-one', kind: 'replay', translated: true },
      { id: 'sample-one', kind: 'objects', translated: false },
      { id: 'suite-one', kind: 'suite', translated: true },
    ]);
    expect(progress).toHaveBeenCalledTimes(6);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ done: 6, total: 6 }));

    expect(await keysOf(target)).toEqual([
      '_malleable/w/tool.json',
      '_suites/suite-one.json',
      '_suites/suite-one.keep.json',
      'human-one/meta.json',
      'human-one/replay.json',
      'old-one/comments.json',
      'old-one/edits.json',
      'old-one/keep.json',
      'old-one/meta.json',
      'old-one/poster.v2.jpg',
      'old-one/replay.json',
      'sample-one/comments.json',
    ]);
    expect(await target.read('old-one/poster.v2.jpg')).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const bundle: unknown = JSON.parse((await target.read('old-one/replay.json'))!.toString('utf8'));
    assertReplayBundle(bundle);
    expect(bundle.meta.source).toBe('agent');
    expect(bundle.meta.tags).toEqual(['smoke', 'purpose:triage']);
    expect(bundle.meta).not.toHaveProperty('purpose');
    expect(bundle.context).toEqual({
      version: 1,
      capturedAt: '2026-10-06T00:00:00.000Z',
      app: { name: 'Example App', environment: 'staging', origin: 'https://app.example.com' },
      test: { suite: 'checkout' },
      sources: [
        { provider: 'slack', ref: 'T1', url: SLACK },
        { provider: 'github', ref: 'acme/web#12', url: 'https://github.com/acme/web/pull/12' },
      ],
      fields: {
        account: { id: 7, label: 'Account 7', flags: [{ key: 'beta', state: 'enabled' }] },
        organization: { id: 3, plan: { state: 'known', name: 'pro' } },
      },
    });

    const suite: unknown = JSON.parse((await target.read('_suites/suite-one.json'))!.toString('utf8'));
    assertReviewSuite(suite);
    expect(suite.subject).toEqual({ provider: 'github', ref: 'acme/web#12', url: 'https://github.com/acme/web/pull/12' });

    // The target serves it: summaries rebuilt from the converted bundle, the keep marker carried over.
    const store = new ReplayStore(target, join(tmpdir(), 'no-samples-here'));
    const listed = await store.list();
    expect(listed.map((summary) => [summary.id, summary.source])).toEqual(
      expect.arrayContaining([
        ['old-one', 'agent'],
        ['human-one', 'human'],
      ]),
    );
    expect(listed.find((summary) => summary.id === 'old-one')).toMatchObject({ kept: { by: 'someone@example.com' }, expiresAt: null });
    expect(await store.listSuites()).toHaveLength(1);
  });

  it('keeps meta.purpose when the target declares the purpose', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    await migrateStore({ from: source, to: target, translate, purposes: ['triage'] });
    const bundle = JSON.parse((await target.read('old-one/replay.json'))!.toString('utf8'));
    expect(bundle.meta).toMatchObject({ purpose: 'triage', tags: ['smoke'] });
  });

  it('is idempotent: a second run converts nothing and resumes what is missing', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    await migrateStore({ from: source, to: target, translate, translateSuite });
    const before = await keysOf(target);

    const again = await migrateStore({ from: source, to: target, translate, translateSuite });
    expect(again.converted).toEqual([]);
    expect(again.unchanged.map(({ id }) => id)).toEqual(['_malleable', 'human-one', 'old-one', 'sample-one', 'suite-one']);
    expect(again.failed.map(({ id }) => id)).toEqual(['broken']);
    expect(await keysOf(target)).toEqual(before);

    // An interrupted run: the missing sidecar is copied, the rest left alone.
    await target.delete('old-one/comments.json');
    const resumed = await migrateStore({ from: source, to: target, translate, translateSuite });
    expect(resumed.converted).toEqual([{ id: 'old-one', kind: 'replay', translated: true, written: ['old-one/comments.json'] }]);
  });

  it('never overwrites a different bundle the target holds', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    await target.write('old-one/replay.json', JSON.stringify(replay('old-one')));
    const report = await migrateStore({ from: source, to: target, translate, translateSuite });
    expect(report.failed).toContainEqual({
      id: 'old-one',
      kind: 'replay',
      reason: 'the target already holds a different old-one/replay.json',
    });
    expect(await target.stat('old-one/comments.json')).toBeUndefined();
  });

  it('skips what the translation leaves invalid, and what it renames', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    // No translation: the legacy shapes do not pass the core validator.
    const plain = await migrateStore({ from: source, to: target });
    expect(plain.failed.map(({ id, reason }) => [id, reason])).toEqual(
      expect.arrayContaining([
        ['old-one', "replay.meta.source must be 'agent' or 'human'"],
        ['suite-one', 'suite contains unsupported fields'],
      ]),
    );
    expect(await target.stat('old-one/replay.json')).toBeUndefined();
    expect(await target.stat('old-one/comments.json')).toBeUndefined();

    const renamed = await migrateStore({
      from: source,
      to: new MemoryStorage(),
      translate: (raw, info) => {
        const bundle = translate(raw, info) as { meta: { id: string } };
        return { ...bundle, meta: { ...bundle.meta, id: `${info.id}-x` } };
      },
    });
    expect(renamed.failed).toContainEqual({ id: 'old-one', kind: 'replay', reason: 'meta.id changed from old-one to old-one-x' });
  });

  it('writes nothing on a dry run, and reports what it would write', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    const report = await migrateStore({ from: source, to: target, translate, translateSuite, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.converted.find(({ id }) => id === 'old-one')?.written).toEqual([
      'old-one/comments.json',
      'old-one/edits.json',
      'old-one/keep.json',
      'old-one/poster.v2.jpg',
      'old-one/replay.json',
    ]);
    expect(report.failed.map(({ id }) => id)).toEqual(['broken']);
    expect(await target.list()).toEqual([]);
  });

  it('refuses to migrate a store into itself', async () => {
    const storage = new MemoryStorage();
    await expect(migrateStore({ from: storage, to: new ReplayStore(storage, tmpdir()) })).rejects.toThrow(/same storage/);
  });
});

describe('compareStores', () => {
  it('lists the summary changes a conversion made', async () => {
    const { source } = await legacyStore();
    const target = new MemoryStorage();
    await migrateStore({ from: source, to: target, translate });
    const comparison = await compareStores({ from: source, to: target });
    expect(comparison.onlyInSource).toEqual(['broken']);
    expect(comparison.onlyInTarget).toEqual([]);
    expect(comparison.identical).toBe(1);
    const changed = comparison.changed.find(({ id }) => id === 'old-one')!;
    expect(changed.fields.map(({ field }) => field).sort()).toEqual(['source', 'sources', 'tags']);
    expect(changed.fields.find(({ field }) => field === 'source')).toEqual({ field: 'source', from: 'toki', to: 'agent' });
    expect(formatComparison(comparison)).toContain('    source: "toki" -> "agent"');
  });
});

describe('replays migrate', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('applies target redaction rules before writing a replay and its summary', async () => {
    const source = new MemoryStorage();
    const target = new MemoryStorage();
    const bundle = replay('private-recording');
    bundle.meta.title = 'Case PRIVATE-123';
    await source.write('private-recording/replay.json', JSON.stringify(bundle), JSON_TYPE);
    const report = await migrateStore({
      from: source,
      to: target,
      redaction: { text: [{ pattern: /PRIVATE-\d+/g, replace: '[private]' }] },
    });
    expect(report.failed).toEqual([]);
    expect((await target.read('private-recording/replay.json'))?.toString()).not.toContain('PRIVATE-123');
    expect((await target.read('private-recording/meta.json'))?.toString()).not.toContain('PRIVATE-123');
  });

  it('passes purposes declared by config and plugins to the CLI translation', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'replays-migrate-source-'));
    const source = new FsStorage(sourceDir);
    await source.write('old-one/replay.json', JSON.stringify(legacyBundle('old-one')), JSON_TYPE);
    const work = await mkdtemp(join(tmpdir(), 'replays-migrate-purposes-'));
    const target = new MemoryStorage();
    (globalThis as { __migrateTarget?: MemoryStorage }).__migrateTarget = target;
    await writeFile(join(work, 'replays.config.mjs'), `export default {
      purposes: [{ id: 'demo', label: 'Demo' }],
      plugins: [{ name: 'target', apiVersion: 1, setup(api) {
        api.storage({ id: 'mem', create: () => globalThis.__migrateTarget });
        api.purpose({ id: 'triage', label: 'Triage' });
      } }]
    };`);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await runMigrateCli(['--from', `fs:${sourceDir}`, '--to', 'mem', '--translate', join(import.meta.dirname, '../examples/migrate/translate.mjs')], { cwd: work, env: {} });
    const migrated = JSON.parse((await target.read('old-one/replay.json'))!.toString());
    expect(migrated.meta.purpose).toBe('triage');
    expect(migrated.meta.tags).not.toContain('purpose:triage');
  });

  it('parses its arguments', () => {
    expect(parseMigrateArgs(['--from', 'fs:a', '--to', 'gcs', '--dry-run', '--concurrency', '2'])).toEqual({
      from: 'fs:a',
      to: 'gcs',
      dryRun: true,
      compare: false,
      concurrency: 2,
    });
    expect(() => parseMigrateArgs(['--from', 'fs:a'])).toThrow(/--from and --to are required/);
    expect(() => parseMigrateArgs(['--from', 'fs:a', '--to', 'b', '--nope'])).toThrow(/unknown option --nope/);
  });

  it('converts into a plugin storage backend and writes the report', async () => {
    const { dir } = await legacyStore();
    const work = await mkdtemp(join(tmpdir(), 'replays-migrate-cli-'));
    const target = new MemoryStorage();
    (globalThis as { __migrateTarget?: MemoryStorage }).__migrateTarget = target;
    await writeFile(
      join(work, 'replays.config.mjs'),
      `export default { plugins: [{ name: 'mem', apiVersion: 1, setup(api) { api.storage({ id: 'mem', create: () => globalThis.__migrateTarget }); } }] };\n`,
    );
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const translator = join(import.meta.dirname, '../examples/migrate/translate.mjs');
    await runMigrateCli(['--from', `fs:${dir}`, '--to', 'mem', '--translate', translator, '--report', 'report.json'], {
      cwd: work,
      env: {},
    });
    expect(process.exitCode).toBe(1); // the broken bundle
    expect(out).toHaveBeenCalledWith('converted 5, unchanged 0, failed 1\n');
    const report = JSON.parse(await readFile(join(work, 'report.json'), 'utf8'));
    expect(report.failed).toEqual([{ id: 'broken', kind: 'replay', reason: 'replay.events must contain an rrweb recording' }]);
    expect(await target.stat('old-one/replay.json')).toBeDefined();

    out.mockClear();
    await runMigrateCli(['--compare', '--from', `fs:${dir}`, '--to', 'mem'], { cwd: work, env: {} });
    expect(String(out.mock.calls.at(-1)?.[0])).toContain('1 identical, 1 changed, 1 only in the source, 0 only in the target');
  });
});
