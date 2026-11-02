import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { DEFAULT_RETENTION, expiryMs, retentionFromEnv, retentionOf } from '../src/shared/retention.ts';
import type { ResolvedSuiteRegistration } from '../src/shared/review-suite.ts';
import { appDefaults, replay } from './fixtures.ts';

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse('2026-10-13T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('retention rules', () => {
  it('expires an upload after one number of days counted from the server upload time', () => {
    const uploadedMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(expiryMs(DEFAULT_RETENTION, { uploadedMs })).toBe(uploadedMs + 30 * DAY);
    expect(expiryMs({ days: 30 }, { uploadedMs })).toBe(uploadedMs + 30 * DAY);
    expect(expiryMs({ days: 1 }, { uploadedMs })).toBe(uploadedMs + DAY);
    // A clock that cannot be read never expires anything.
    expect(expiryMs({ days: 30 }, { uploadedMs: Number.NaN })).toBeUndefined();
  });

  it('never expires with 0 days, nor anything that someone kept', () => {
    const uploadedMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(expiryMs({ days: 0 }, { uploadedMs })).toBeUndefined();
    expect(expiryMs({ days: 30 }, { uploadedMs, kept: { by: 'ada@example.com', at: '2026-01-02T00:00:00.000Z' } })).toBeUndefined();
  });

  it('describes retention for the API: the keep record and an ISO expiry, or null', () => {
    const uploadedMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(retentionOf({ days: 7 }, { uploadedMs })).toEqual({ expiresAt: '2026-01-08T00:00:00.000Z' });
    expect(retentionOf({ days: 0 }, { uploadedMs })).toEqual({ expiresAt: null });
    const kept = { by: 'ada@example.com', at: '2026-01-02T00:00:00.000Z' };
    expect(retentionOf({ days: 7 }, { uploadedMs, kept })).toEqual({ kept, expiresAt: null });
  });

  it('reads RETENTION_DAYS, where 0 means never', () => {
    expect(retentionFromEnv({})).toEqual(DEFAULT_RETENTION);
    expect(retentionFromEnv({ RETENTION_DAYS: '  ' })).toEqual(DEFAULT_RETENTION);
    expect(retentionFromEnv({ RETENTION_DAYS: '14' })).toEqual({ days: 14 });
    expect(retentionFromEnv({ RETENTION_DAYS: '0' })).toEqual({ days: 0 });
    expect(retentionFromEnv({ RETENTION_DAYS: '3650' })).toEqual({ days: 3650 });
    for (const bad of ['-1', '1.5', 'soon', '3651']) expect(() => retentionFromEnv({ RETENTION_DAYS: bad })).toThrow(/RETENTION_DAYS/);
  });
});

const suiteInput = (id: string, createdAt: string): ResolvedSuiteRegistration => ({
  version: 1,
  id,
  title: 'Review',
  createdAt,
  subject: { provider: 'github', ref: 'example-org/shop-demo#1', url: 'https://github.com/example-org/shop-demo/issues/1' },
});

function captured(id: string, capturedDaysAgo: number) {
  const bundle = replay(id);
  bundle.meta.capturedAt = daysAgo(capturedDaysAgo);
  return bundle;
}

/** The server's upload time of a stored replay (the memory driver below stamps objects 200 days before NOW). */
const uploadedMs = async (store: ReplayStore, id: string) => (await store.storage.stat(store.replayKey(id)))!.createdMs;

function openStore(days: number | undefined, clock = () => NOW - 200 * DAY) {
  return mkdtemp(join(tmpdir(), 'replays-retention-')).then(
    (root) => new ReplayStore(new MemoryStorage(clock), join(root, 'sample'), days),
  );
}

describe('retention and keep in the store', () => {
  it('prunes from the upload time, never from the capture time, and never kept replays', async () => {
    const store = await openStore(30);
    // Capture times are the recording machine's clock and do not count: one is 400 days old, one is in the future.
    await store.save(captured('old-capture', 400));
    await store.save(captured('future-capture', -30));
    await store.save(captured('kept-replay', 300));
    await store.keep('kept-replay', 'ada@example.com', new Date(NOW));
    const uploaded = await uploadedMs(store, 'old-capture');

    const listed = Object.fromEntries((await store.list()).map((summary) => [summary.id, summary]));
    expect(listed['future-capture']?.expiresAt).toBe(new Date(uploaded + 30 * DAY).toISOString());
    expect(listed['old-capture']?.expiresAt).toBe(new Date(uploaded + 30 * DAY).toISOString());
    expect(listed['kept-replay']).toMatchObject({ kept: { by: 'ada@example.com', at: new Date(NOW).toISOString() }, expiresAt: null });
    await expect(store.replayRetention('kept-replay')).resolves.toEqual({
      kept: { by: 'ada@example.com', at: new Date(NOW).toISOString() },
      expiresAt: null,
    });

    // 29 days after the upload nothing has expired, however old the capture time says it is.
    await expect(store.prune(uploaded + 29 * DAY)).resolves.toEqual([]);
    const removed = await store.prune(uploaded + 31 * DAY);
    expect(removed.toSorted()).toEqual(['future-capture', 'old-capture']);
    await expect(store.load('kept-replay')).resolves.toBeTruthy();

    // Released, a kept replay expires on the normal rule again.
    await expect(store.unkeep('kept-replay')).resolves.toMatchObject({ expiresAt: expect.any(String) });
    expect((await store.replayRetention('kept-replay'))?.kept).toBeUndefined();
    await expect(store.prune(uploaded + 31 * DAY)).resolves.toEqual(['kept-replay']);
  });

  it('keeps everything when RETENTION_DAYS is 0', async () => {
    const store = await openStore(0);
    await store.save(captured('forever', 900));
    await store.registerSuite('forever-suite', suiteInput('forever-suite', daysAgo(900)));
    const uploaded = await uploadedMs(store, 'forever');
    await expect(store.prune(uploaded + 5000 * DAY)).resolves.toEqual([]);
    await expect(store.summary('forever')).resolves.toMatchObject({ expiresAt: null });
    await expect(store.suiteRetention('forever-suite')).resolves.toEqual({ expiresAt: null });
  });

  it('defaults to 30 days when no policy is given', async () => {
    const store = await openStore(undefined);
    expect(store.retention).toEqual({ days: 30 });
    await store.save(captured('default-days', 1));
    const uploaded = await uploadedMs(store, 'default-days');
    await expect(store.prune(uploaded + 29 * DAY)).resolves.toEqual([]);
    await expect(store.prune(uploaded + 31 * DAY)).resolves.toEqual(['default-days']);
  });

  it('keeps a suite and its runs past the window, and releasing it lets them expire', async () => {
    const store = await openStore(30);
    await store.registerSuite('old-suite', suiteInput('old-suite', daysAgo(150)));
    await store.registerSuite('kept-suite', suiteInput('kept-suite', daysAgo(150)));
    const run = { id: 'run-1', sequence: 1, label: 'Run', status: 'passed' as const, startedAt: daysAgo(150) };
    await store.registerRun('kept-suite', 'run-1', run);
    const bundle = captured('kept-suite-run', 150);
    bundle.suiteRun = { suiteId: 'kept-suite', runId: 'run-1' };
    await store.save(bundle);
    await store.attachReplay('kept-suite', 'run-1', bundle);
    await store.keepSuite('kept-suite', 'ada@example.com');

    // A suite counts from its file's server time, not its (client) createdAt.
    const suiteUploaded = (await store.storage.stat(store.suiteKey('old-suite')))!.createdMs;
    const summaries = await store.listSuiteSummaries();
    expect(summaries.find((suite) => suite.id === 'old-suite')?.expiresAt).toBe(new Date(suiteUploaded + 30 * DAY).toISOString());
    expect(summaries.find((suite) => suite.id === 'kept-suite')).toMatchObject({ kept: { by: 'ada@example.com' }, expiresAt: null });
    const [entry] = (await store.listSuiteIndex()).filter((suite) => suite.id === 'kept-suite');
    expect(entry?.runDetails[0]?.replay).toMatchObject({ id: 'kept-suite-run', expiresAt: null });
    await expect(store.summary('kept-suite-run')).resolves.toMatchObject({ expiresAt: null });

    const pruneAt = Math.max(suiteUploaded, await uploadedMs(store, 'kept-suite-run')) + 31 * DAY;
    const removed = await store.prune(pruneAt);
    expect(removed).toContain('suite:old-suite');
    expect(removed).not.toContain('suite:kept-suite');
    expect(removed).not.toContain('kept-suite-run');
    await expect(store.loadSuite('kept-suite')).resolves.toBeTruthy();
    await expect(store.load('kept-suite-run')).resolves.toBeTruthy();

    // Released, the suite and its run expire on the normal rule again.
    await expect(store.unkeepSuite('kept-suite')).resolves.toMatchObject({ expiresAt: expect.any(String) });
    await expect(store.summary('kept-suite-run')).resolves.toMatchObject({ expiresAt: expect.any(String) });
    expect((await store.prune(pruneAt)).toSorted()).toEqual(['kept-suite-run', 'suite:kept-suite']);
  });

  it('logs one summary line per sweep', async () => {
    const store = await openStore(30);
    await store.save(captured('swept', 1));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await store.prune((await uploadedMs(store, 'swept')) + 31 * DAY);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toMatch(/^retention sweep: removed 1 of 1 replays and 0 of 0 suites in \d+ ms$/);
    } finally {
      log.mockRestore();
    }
  });
});

describe('keep API', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function start() {
    const root = await mkdtemp(join(tmpdir(), 'replays-keep-'));
    const store = new ReplayStore(new MemoryStorage(), join(root, 'sample'));
    const handle = createApp({ ...appDefaults(), store, clientDir: root });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const origin = `http://127.0.0.1:${address.port}`;
    return { origin, store, api: `${origin}/api` };
  }

  it('keeps and releases a replay, recording the signed-in identity, and the list shows it', async () => {
    const { origin, store, api } = await start();
    await store.save(captured('to-keep', 1));
    const headers = { origin, 'x-dev-user': 'ada@example.com' };

    const before = await (await fetch(`${api}/replays/to-keep/keep`)).json();
    expect(before).toEqual({ expiresAt: expect.any(String) });

    const kept = await fetch(`${api}/replays/to-keep/keep`, { method: 'PUT', headers });
    expect(kept.status).toBe(200);
    expect(await kept.json()).toEqual({ kept: { by: 'ada@example.com', at: expect.any(String) }, expiresAt: null });
    const [summary] = await (await fetch(`${api}/replays`)).json();
    expect(summary).toMatchObject({ id: 'to-keep', kept: { by: 'ada@example.com' }, expiresAt: null });

    const released = await fetch(`${api}/replays/to-keep/keep`, { method: 'DELETE', headers });
    expect(await released.json()).toEqual({ expiresAt: expect.any(String) });
  });

  it('refuses cross-site writes, unknown ids and other methods', async () => {
    const { store, api } = await start();
    await store.save(captured('guarded', 1));
    expect((await fetch(`${api}/replays/guarded/keep`, { method: 'PUT', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(`${api}/replays/missing/keep`)).status).toBe(404);
    const { origin } = new URL(api);
    expect((await fetch(`${api}/replays/missing/keep`, { method: 'PUT', headers: { origin } })).status).toBe(404);
    expect((await fetch(`${api}/replays/guarded/keep`, { method: 'POST', headers: { origin } })).status).toBe(405);
  });

  it('keeps a suite', async () => {
    const { origin, store, api } = await start();
    await store.registerSuite('a-suite', suiteInput('a-suite', daysAgo(1)));
    const response = await fetch(`${api}/suites/a-suite/keep`, { method: 'PUT', headers: { origin, 'x-dev-user': 'ada@example.com' } });
    expect(await response.json()).toMatchObject({ kept: { by: 'ada@example.com' }, expiresAt: null });
    const [listed] = await (await fetch(`${api}/suites`)).json();
    expect(listed).toMatchObject({ id: 'a-suite', kept: { by: 'ada@example.com' }, expiresAt: null });
    expect((await fetch(`${api}/suites/missing/keep`, { method: 'PUT', headers: { origin } })).status).toBe(404);
  });

  it('records the anonymous identity when no sign-in is configured', async () => {
    const { origin, store, api } = await start();
    await store.save(captured('anon-keep', 1));
    const kept = await fetch(`${api}/replays/anon-keep/keep`, { method: 'PUT', headers: { origin } });
    expect(await kept.json()).toMatchObject({ kept: { by: 'anonymous' } });
  });
});
