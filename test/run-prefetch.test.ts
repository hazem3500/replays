import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { cancelReplayPrefetch, replayCached, replayQuery } from '../src/client/queries.ts';
import { prefetchOrder, RunPrefetcher } from '../src/client/suite/prefetch-runs.ts';

const never = () => new Promise<never>(() => undefined);
const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];

describe('prefetchOrder', () => {
  it('goes next, previous, then outwards', () => {
    expect(prefetchOrder(ids, 'r4', 10)).toEqual(['r5', 'r3', 'r6', 'r2', 'r7', 'r1']);
  });

  it('runs one way at the ends of the suite', () => {
    expect(prefetchOrder(ids, 'r1', 3)).toEqual(['r2', 'r3', 'r4']);
    expect(prefetchOrder(ids, 'r7', 2)).toEqual(['r6', 'r5']);
  });

  it('stops at the limit and names nothing for an unknown run', () => {
    expect(prefetchOrder(ids, 'r4', 1)).toEqual(['r5']);
    expect(prefetchOrder(ids, 'nope', 4)).toEqual([]);
    expect(prefetchOrder(ids, undefined, 4)).toEqual([]);
    expect(prefetchOrder(ids, 'r4', 0)).toEqual([]);
  });
});

function harness(cached: string[] = []) {
  const pending = new Map<string, { resolve(): void; reject(): void }>();
  const started: string[] = [];
  const cancelled: string[] = [];
  const done = new Set(cached);
  const prefetcher = new RunPrefetcher({
    prefetch: (id) =>
      new Promise<void>((resolve, reject) => {
        started.push(id);
        pending.set(id, {
          resolve: () => {
            done.add(id);
            resolve();
          },
          reject,
        });
      }),
    cancel: (id) => cancelled.push(id),
    isCached: (id) => done.has(id),
  });
  const finish = async (id: string) => {
    pending.get(id)?.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { prefetcher, started, cancelled, finish, pending };
}

describe('RunPrefetcher', () => {
  it('loads in the given order, two at a time', async () => {
    const { prefetcher, started, finish } = harness();
    prefetcher.schedule(['r5', 'r3', 'r6', 'r2']);
    expect(started).toEqual(['r5', 'r3']);
    await finish('r5');
    expect(started).toEqual(['r5', 'r3', 'r6']);
    await finish('r3');
    expect(started).toEqual(['r5', 'r3', 'r6', 'r2']);
  });

  it('skips runs already cached and carries on after a failed load', async () => {
    const { prefetcher, started, pending } = harness(['r5']);
    prefetcher.schedule(['r5', 'r3', 'r6']);
    expect(started).toEqual(['r3', 'r6']);
    pending.get('r3')?.reject();
    await Promise.resolve();
    await Promise.resolve();
    prefetcher.schedule(['r2']);
    expect(started).toEqual(['r3', 'r6', 'r2']);
  });

  it('replaces the waiting runs on a new schedule while loads in flight keep their slots', async () => {
    const { prefetcher, started, finish } = harness();
    prefetcher.schedule(['r5', 'r3', 'r6']);
    prefetcher.schedule(['r2', 'r1']);
    expect(started).toEqual(['r5', 'r3']);
    await finish('r5');
    expect(started).toEqual(['r5', 'r3', 'r2']);
  });

  it('cancels what is in flight and starts nothing more once the suite is left', async () => {
    const { prefetcher, started, cancelled, finish } = harness();
    prefetcher.schedule(['r5', 'r3', 'r6']);
    prefetcher.abort();
    expect(cancelled).toEqual(['r5', 'r3']);
    await finish('r5');
    prefetcher.schedule(['r2']);
    expect(started).toEqual(['r5', 'r3']);
  });
});

describe('replay prefetch cache', () => {
  it('reports loaded and loading runs, and cancels a preload nothing shows', async () => {
    const client = new QueryClient();
    expect(replayCached(client, 'a')).toBe(false);
    void client.prefetchQuery({ ...replayQuery('a'), queryFn: never });
    expect(replayCached(client, 'a')).toBe(true);
    cancelReplayPrefetch(client, 'a');
    await Promise.resolve();
    expect(client.getQueryCache().find({ queryKey: ['replay', 'a'] })?.state.fetchStatus).toBe('idle');
    client.setQueryData(replayQuery('b').queryKey, { meta: { id: 'b' } } as never);
    expect(replayCached(client, 'b')).toBe(true);
  });

  it('leaves a preload a viewer has picked up to finish', () => {
    const client = new QueryClient();
    const observer = client.getQueryCache().build(client, { ...replayQuery('a'), queryFn: never });
    void observer.fetch();
    const watch = vi.spyOn(observer, 'getObserversCount').mockReturnValue(1);
    cancelReplayPrefetch(client, 'a');
    expect(observer.state.fetchStatus).toBe('fetching');
    watch.mockRestore();
  });
});
