import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ReplayStore } from '../src/server/store.ts';
import { assertReplayBundle, SUMMARY_VERSION } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

describe('ReplayStore', () => {
  it('writes atomically and reads uploaded replays', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());
    await expect(store.load('test-replay')).resolves.toEqual(replay());
  });

  it('refuses to overwrite an existing replay id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());

    const replacement = replay();
    replacement.meta.title = 'Replacement';
    await expect(store.save(replacement)).rejects.toMatchObject({ status: 409 });
    await expect(store.load('test-replay')).resolves.toMatchObject({ meta: { title: 'Test replay' } });
  });

  it('falls back to the committed sample directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const sample = join(root, 'sample');
    await mkdir(sample);
    await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    const store = new ReplayStore(join(root, 'data'), sample);
    await expect(store.load('sample-replay')).resolves.toMatchObject({ meta: { id: 'sample-replay' } });
  });

  it('refuses to shadow a committed sample replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const sample = join(root, 'sample');
    await mkdir(sample);
    await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    const store = new ReplayStore(join(root, 'data'), sample);

    await expect(store.save(replay('sample-replay'))).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to overwrite an uploaded replay video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(replay());
    await store.saveVideo('test-replay', Buffer.from('first'));

    await expect(store.saveVideo('test-replay', Buffer.from('replacement'))).rejects.toMatchObject({ status: 409 });
    await expect(readFile(store.videoFile('test-replay'), 'utf8')).resolves.toBe('first');
  });

  it('refuses to attach a video to a committed sample replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const sample = join(root, 'sample');
    await mkdir(sample);
    await writeFile(join(sample, 'sample-replay.json'), JSON.stringify(replay('sample-replay')));
    const store = new ReplayStore(join(root, 'data'), sample);

    await expect(store.saveVideo('sample-replay', Buffer.from('video'))).rejects.toMatchObject({ status: 409 });
  });

  it('removes uploads older than the retention window without touching samples', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 7);
    // Age counts from the upload (the stored file's time) only: the capture time is the client's clock.
    const old = replay('old-replay');
    old.meta.capturedAt = '2026-10-05T00:00:00.000Z';
    await store.save(old);
    const file = join(root, 'data', 'old-replay', 'replay.json');
    await utimes(file, new Date('2026-09-01'), new Date('2026-09-01'));
    const fresh = replay('fresh-replay');
    fresh.meta.capturedAt = '2025-01-01T00:00:00.000Z';
    await store.save(fresh);
    await utimes(join(root, 'data', 'fresh-replay', 'replay.json'), new Date('2026-10-05'), new Date('2026-10-05'));
    await expect(store.prune(Date.parse('2026-10-06'))).resolves.toEqual(['old-replay']);
    await expect(stat(file)).rejects.toThrow('ENOENT');
    await expect(store.load('fresh-replay')).resolves.toBeTruthy();
  });

  it('removes expired orphan directories without replay.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const directory = join(root, 'data', 'orphan-replay');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'replay.json.crashed.tmp'), 'partial');
    await utimes(join(directory, 'replay.json.crashed.tmp'), new Date('2026-09-01'), new Date('2026-09-01'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 7);

    await expect(store.prune(Date.parse('2026-10-06'))).resolves.toEqual(['orphan-replay']);
    await expect(stat(directory)).rejects.toThrow('ENOENT');
  });

  it('removes expired review suites and keeps a fresh one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-store-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 7);
    const subject = { provider: 'github', url: 'https://github.com/example-org/shop-demo/issues/42', ref: 'example-org/shop-demo#42' };
    await store.registerSuite('old-suite', {
      version: 1,
      id: 'old-suite',
      title: 'Old review',
      createdAt: '2026-09-01T00:00:00.000Z',
      subject,
    });
    await store.registerSuite('new-suite', {
      version: 1,
      id: 'new-suite',
      title: 'New review',
      createdAt: '2026-10-05T00:00:00.000Z',
      subject,
    });

    // Suites count from their file's server time; `createdAt` (the reviewer's clock) does not matter.
    await utimes(join(root, 'data', '_suites', 'old-suite.json'), new Date('2026-09-01'), new Date('2026-09-01'));
    await utimes(join(root, 'data', '_suites', 'new-suite.json'), new Date('2026-10-05'), new Date('2026-10-05'));
    await expect(store.prune(Date.parse('2026-10-06T00:00:00.000Z'))).resolves.toEqual(['suite:old-suite']);
    await expect(store.loadSuite('old-suite')).resolves.toBeUndefined();
    await expect(store.loadSuite('new-suite')).resolves.toMatchObject({ id: 'new-suite' });
  });
});

async function storeWith(...bundles: ReturnType<typeof replay>[]) {
  const root = await mkdtemp(join(tmpdir(), 'replays-summary-'));
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  for (const bundle of bundles) await store.save(bundle);
  return { root, store };
}

describe('replay summaries', () => {
  it('writes a meta.json sidecar on save', async () => {
    const bundle = replay('with-errors');
    bundle.console.push({ at: 10, level: 'error', message: 'Boom' }, { at: 12, level: 'warn', message: 'meh' });
    bundle.network.push({
      id: 'r1',
      at: 5,
      duration: 1,
      method: 'GET',
      url: 'https://example.com/x',
      status: 503,
      statusText: '',
      requestHeaders: [],
      responseHeaders: [],
    });
    const { root } = await storeWith(bundle);
    const sidecar = JSON.parse(await readFile(join(root, 'data', 'with-errors', 'meta.json'), 'utf8'));
    expect(sidecar).toEqual({
      id: 'with-errors',
      title: 'Test replay',
      url: 'https://example.com/',
      host: 'example.com',
      capturedAt: '2026-10-06T00:00:00.000Z',
      duration: 1000,
      steps: 1,
      consoleErrors: 1,
      failedRequests: 1,
      source: 'agent',
      summaryVersion: SUMMARY_VERSION,
      viewport: { width: 1440, height: 900 },
      timeline: { steps: [0], errors: [{ at: 5, count: 2 }] },
    });
  });

  it('rebuilds sidecars written by an older summary version (no timeline yet)', async () => {
    const { root, store } = await storeWith(replay('older'));
    const path = join(root, 'data', 'older', 'meta.json');
    const current = JSON.parse(await readFile(path, 'utf8'));
    const { summaryVersion: _version, timeline: _timeline, viewport: _viewport, ...v1 } = current;
    await writeFile(path, JSON.stringify({ ...v1, title: 'v1 sidecar' }));
    const rebuilt = await store.summary('older');
    expect(rebuilt).toMatchObject({ title: 'Test replay', summaryVersion: SUMMARY_VERSION, timeline: { steps: [0], errors: [] } });
    await expect(readFile(path, 'utf8').then(JSON.parse)).resolves.toMatchObject({ summaryVersion: SUMMARY_VERSION });
  });

  it('prunes a replay together with its poster', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-summary-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 1);
    await store.save(replay('old-one'));
    await writeFile(store.posterFile('old-one'), 'jpeg');
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await utimes(join(root, 'data', 'old-one', 'replay.json'), old, old);
    await expect(store.prune()).resolves.toEqual(['old-one']);
    await expect(stat(store.posterFile('old-one'))).rejects.toThrow(/ENOENT/);
  });

  it('backfills a missing or stale sidecar lazily', async () => {
    const { root, store } = await storeWith(replay('legacy'));
    const sidecar = join(root, 'data', 'legacy', 'meta.json');
    await rm(sidecar);
    await expect(store.list()).resolves.toMatchObject([{ id: 'legacy', steps: 1 }]);
    await expect(stat(sidecar)).resolves.toBeTruthy();

    // A sidecar older than its replay.json is rebuilt; a corrupt one too.
    await writeFile(sidecar, '{"id":"legacy","title":"stale"}');
    await utimes(sidecar, new Date('2026-01-01'), new Date('2026-01-01'));
    await expect(store.summary('legacy')).resolves.toMatchObject({ title: 'Test replay' });
    await writeFile(sidecar, 'not json');
    await expect(store.summary('legacy')).resolves.toMatchObject({ title: 'Test replay' });
  });

  it('lists from sidecars without reading bundles', async () => {
    const { root, store } = await storeWith(replay('fast'));
    const sidecar = JSON.parse(await readFile(join(root, 'data', 'fast', 'meta.json'), 'utf8'));
    await writeFile(join(root, 'data', 'fast', 'meta.json'), JSON.stringify({ ...sidecar, title: 'From sidecar' }));
    await expect(store.list()).resolves.toMatchObject([{ id: 'fast', title: 'From sidecar' }]);
  });

  it('parses each sidecar once, and again when it changes', async () => {
    const { root, store } = await storeWith(replay('cached'));
    const path = join(root, 'data', 'cached', 'meta.json');
    const first = await store.list();
    await expect(store.list()).resolves.toEqual(first);
    const sidecar = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...sidecar, title: 'Rewritten' }));
    // A later mtime than the cached parse: re-read.
    await utimes(path, new Date(), new Date(Date.now() + 5_000));
    await expect(store.list()).resolves.toMatchObject([{ id: 'cached', title: 'Rewritten' }]);
  });

  it('summarizes committed samples and skips non-replay JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-summary-'));
    const sample = join(root, 'sample');
    await mkdir(sample);
    await writeFile(join(sample, 'sample-one.json'), JSON.stringify(replay('sample-one')));
    await writeFile(join(sample, 'example.steps.json'), '[]');
    const store = new ReplayStore(join(root, 'data'), sample);
    await expect(store.list()).resolves.toMatchObject([{ id: 'sample-one', source: 'agent' }]);
  });

  it('filters by query, host, errors and source', async () => {
    const plain = replay('plain-run');
    plain.meta.title = 'Checkout flow';
    plain.meta.url = 'https://shop.example.org/cart';
    const failing = replay('failing-run');
    failing.meta.title = 'Login';
    failing.network.push({
      id: 'r',
      at: 1,
      duration: 1,
      method: 'POST',
      url: 'https://example.com/api',
      status: 0,
      statusText: 'net::ERR_CONNECTION_REFUSED',
      requestHeaders: [],
      responseHeaders: [],
    });
    const human = replay('human-run');
    human.meta.source = 'human';
    human.meta.capturedAt = '2026-10-07T00:00:00.000Z';
    const { store } = await storeWith(plain, failing, human);

    const ids = async (filters: Parameters<ReplayStore['list']>[0]) => (await store.list(filters)).map((summary) => summary.id);
    const all = await ids({});
    expect(all[0]).toBe('human-run');
    expect(all.toSorted()).toEqual(['failing-run', 'human-run', 'plain-run']);
    await expect(ids({ q: 'CHECKOUT' })).resolves.toEqual(['plain-run']);
    await expect(ids({ q: 'shop.example' })).resolves.toEqual(['plain-run']);
    await expect(ids({ host: 'example.com' })).resolves.toEqual(expect.arrayContaining(['failing-run', 'human-run']));
    await expect(ids({ errors: true })).resolves.toEqual(['failing-run']);
    await expect(ids({ source: 'human' })).resolves.toEqual(['human-run']);
    await expect(ids({ source: 'agent', host: 'shop.example.org' })).resolves.toEqual(['plain-run']);
  });

  it('rejects a non-string title and keeps it from failing every search', async () => {
    const broken = replay('broken-title');
    (broken.meta as { title: unknown }).title = 12;
    expect(() => assertReplayBundle(broken)).toThrow(/title must be a string/);

    const { root, store } = await storeWith(replay('kept'));
    await mkdir(join(root, 'data', 'broken-title'));
    await writeFile(join(root, 'data', 'broken-title', 'replay.json'), JSON.stringify(broken));
    await expect(store.list({ q: 'test' })).resolves.toMatchObject([{ id: 'kept' }]);
  });
});
