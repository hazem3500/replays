import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { prefetchAllowed } from '../prefetch-allowed.ts';
import { cancelReplayPrefetch, prefetchReplay, REPLAY_CACHE_LIMITS, replayCached } from '../queries.ts';
import { prefetchOrder, RunPrefetcher } from '../suite/prefetch-runs.ts';

/**
 * Preloads a suite's other runs once the one on screen is `ready`: nearest first, two at a time, at low priority, and
 * not at all on data saver or a 2g link. Leaving the suite cancels the loads nothing is waiting for.
 */
export function useRunPrefetch(runIds: readonly string[], selected: string | undefined, ready: boolean) {
  const queryClient = useQueryClient();
  const prefetcher = useRef<RunPrefetcher | undefined>(undefined);
  useEffect(() => {
    const own = new RunPrefetcher({
      prefetch: (id) => prefetchReplay(queryClient, id),
      cancel: (id) => cancelReplayPrefetch(queryClient, id),
      isCached: (id) => replayCached(queryClient, id),
    });
    prefetcher.current = own;
    return () => {
      own.abort();
      prefetcher.current = undefined;
    };
  }, [queryClient]);

  const key = runIds.join('|');
  useEffect(() => {
    if (!ready || !selected || !prefetchAllowed()) return;
    // why: the selected run holds one of the cache's slots; a further preload would evict a nearer one.
    const order = prefetchOrder(key.split('|'), selected, REPLAY_CACHE_LIMITS.maxEntries - 1);
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 300));
    const handle = idle(() => prefetcher.current?.schedule(order));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle);
  }, [key, ready, selected]);
}
