// @vitest-environment happy-dom
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySummary } from '../src/shared/replay.ts';
import { memoryStorage, type PersistStorage } from '../src/client/data/persist.ts';
import { indexReplaysQuery, indexSuitesQuery, persistIndexQueries } from '../src/client/index/index-queries.ts';

const summary = (id: string): ReplaySummary => ({
  id,
  title: id,
  url: 'https://shop.example/',
  host: 'shop.example',
  capturedAt: '2026-10-27T12:00:00.000Z',
  duration: 1000,
  steps: 1,
  consoleErrors: 0,
  failedRequests: 0,
  source: 'agent',
});
const as = (id: string) => () => Promise.resolve(id);
/** Restores wait for the read here, so a slow first read never passes for an empty cache. */
const READ = 10_000;

/** Waits for the debounced save to reach `storage`. */
const savedIn = (storage: PersistStorage) =>
  vi.waitFor(async () => {
    if (!(await storage.read())) throw new Error('not saved yet');
  });

async function persistAs(storage: PersistStorage, id: string, lists: Record<string, ReplaySummary[]>) {
  const client = new QueryClient();
  await persistIndexQueries(client, { storage, identity: as(id), readTimeoutMs: READ });
  for (const [search, list] of Object.entries(lists)) client.setQueryData(indexReplaysQuery(search).queryKey, list);
  await savedIn(storage);
}

describe('index query persistence', () => {
  beforeEach(() => sessionStorage.clear());

  it('restores the index lists into a fresh client for the same identity', async () => {
    const storage = memoryStorage();
    await persistAs(storage, 'u-1', { '?errors=1': [summary('demo')] });
    const next = new QueryClient();
    await persistIndexQueries(next, { storage, identity: as('u-1'), readTimeoutMs: READ });
    expect(next.getQueryData(indexReplaysQuery('?errors=1').queryKey)?.map((row) => row.id)).toEqual(['demo']);
  });

  it('keeps only the index lists, never replay bundles', async () => {
    const storage = memoryStorage();
    const first = new QueryClient();
    await persistIndexQueries(first, { storage, identity: as('u-1'), readTimeoutMs: READ });
    first.setQueryData(indexSuitesQuery('suites?expand=runs&limit=100').queryKey, []);
    first.setQueryData(['replay', 'demo'], { big: true });
    await savedIn(storage);
    const next = new QueryClient();
    await persistIndexQueries(next, { storage, identity: as('u-1'), readTimeoutMs: READ });
    expect([next.getQueryData(indexSuitesQuery('suites?expand=runs&limit=100').queryKey), next.getQueryData(['replay', 'demo'])]).toEqual([
      [],
      undefined,
    ]);
  });

  it('drops a cache saved by another identity', async () => {
    const storage = memoryStorage();
    await persistAs(storage, 'u-1', { '': [summary('private')] });
    const other = new QueryClient();
    await persistIndexQueries(other, { storage, identity: as('u-2'), readTimeoutMs: READ });
    await vi.waitFor(() => expect(other.getQueryData(indexReplaysQuery('').queryKey)).toBeUndefined());
    expect(await storage.read()).toBeUndefined();
  });

  it('ignores a cache older than a day', async () => {
    const storage = memoryStorage();
    await persistAs(storage, 'u-1', { '': [summary('mine')] });
    const tomorrow = new QueryClient();
    await persistIndexQueries(tomorrow, { storage, identity: as('u-1'), readTimeoutMs: READ, now: () => Date.now() + 25 * 60 * 60_000 });
    expect(tomorrow.getQueryData(indexReplaysQuery('').queryKey)).toBeUndefined();
  });

  it('clears the tab-only caches it replaced', async () => {
    sessionStorage.setItem('replays-index-queries', '{}');
    sessionStorage.setItem('replays-index-lists', '{}');
    await persistIndexQueries(new QueryClient(), { storage: memoryStorage(), identity: as('u-1') });
    expect([sessionStorage.getItem('replays-index-queries'), sessionStorage.getItem('replays-index-lists')]).toEqual([null, null]);
  });
});
