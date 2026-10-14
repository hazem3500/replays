import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { bundlesToEvict, type CachedBundle, capReplayCache } from '../src/client/queries.ts';

const MB = 1024 * 1024;
const entry = (hash: string, lastUsed: number, bytes = MB, active = false): CachedBundle => ({ hash, bytes, lastUsed, active });

describe('bundlesToEvict', () => {
  it('keeps everything within both limits', () => {
    expect(bundlesToEvict([entry('a', 1), entry('b', 2), entry('c', 3)], { maxEntries: 3, maxBytes: 60 * MB })).toEqual([]);
  });

  it('drops the least recently used beyond the entry limit', () => {
    const entries = [entry('c', 3), entry('a', 1), entry('d', 4), entry('b', 2)];
    expect(bundlesToEvict(entries, { maxEntries: 3, maxBytes: 60 * MB })).toEqual(['a']);
    expect(bundlesToEvict(entries, { maxEntries: 1, maxBytes: 60 * MB })).toEqual(['a', 'b', 'c']);
    expect(bundlesToEvict(entries, { maxEntries: 0, maxBytes: 0 })).toEqual(['a', 'b', 'c']);
  });

  it('drops old bundles until the decoded size fits, even under the entry limit', () => {
    const entries = [entry('old', 1, 25 * MB), entry('mid', 2, 25 * MB), entry('new', 3, 20 * MB)];
    expect(bundlesToEvict(entries, { maxEntries: 3, maxBytes: 60 * MB })).toEqual(['old']);
    expect(bundlesToEvict(entries, { maxEntries: 3, maxBytes: 20 * MB })).toEqual(['old', 'mid']);
  });

  it('never drops a bundle on screen or the newest one, even over budget', () => {
    const entries = [entry('shown', 1, 80 * MB, true), entry('b', 2), entry('c', 3)];
    expect(bundlesToEvict(entries, { maxEntries: 3, maxBytes: 60 * MB })).toEqual(['b']);
    expect(bundlesToEvict([entry('shown', 1, 80 * MB, true)], { maxEntries: 3, maxBytes: 60 * MB })).toEqual([]);
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('capReplayCache', () => {
  const sizes = new Map<unknown, number>();
  const setup = (limits = { maxEntries: 2, maxBytes: 10 * MB }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    capReplayCache(client.getQueryCache(), limits, (data) => sizes.get(data) ?? 0);
    const load = async (id: string, bytes = MB) => {
      const data = { id };
      sizes.set(data, bytes);
      await client.fetchQuery({ queryKey: ['replay', id], queryFn: async () => data });
      await settle();
    };
    const cached = () =>
      client
        .getQueryCache()
        .findAll({ queryKey: ['replay'] })
        .map((query) => query.queryKey[1])
        .toSorted();
    return { client, load, cached };
  };

  it('keeps the most recent bundles and forgets the oldest', async () => {
    const { load, cached } = setup();
    await load('a');
    await load('b');
    await load('c');
    expect(cached()).toEqual(['b', 'c']);
  });

  it('counts a revisit as a use', async () => {
    const { client, load, cached } = setup();
    await load('a');
    await load('b');
    // Viewing "a" again (an observer subscribes) makes "b" the least recently used.
    const unsubscribe = new QueryObserver(client, { queryKey: ['replay', 'a'], queryFn: async () => ({ id: 'a' }) }).subscribe(() => {});
    unsubscribe();
    await load('c');
    expect(cached()).toEqual(['a', 'c']);
  });

  it('evicts by size and spares the bundle on screen', async () => {
    const { client, load, cached } = setup({ maxEntries: 3, maxBytes: 10 * MB });
    await load('shown', 8 * MB);
    const unsubscribe = new QueryObserver(client, { queryKey: ['replay', 'shown'], queryFn: async () => ({ id: 'shown' }) }).subscribe(
      () => {},
    );
    await load('next', 4 * MB);
    // 12 MB > 10 MB, but "shown" is on screen and "next" is the newest: both stay until the viewer lets go.
    expect(cached()).toEqual(['next', 'shown']);
    unsubscribe();
    await settle();
    expect(cached()).toEqual(['next']);
  });

  it('leaves other queries alone', async () => {
    const { client, load, cached } = setup({ maxEntries: 1, maxBytes: 10 * MB });
    await client.fetchQuery({ queryKey: ['suite', 's'], queryFn: async () => ({}) });
    await load('a');
    await load('b');
    expect(cached()).toEqual(['b']);
    expect(client.getQueryData(['suite', 's'])).toEqual({});
  });
});
