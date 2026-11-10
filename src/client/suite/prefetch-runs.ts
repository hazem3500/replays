/**
 * Preloading a suite's other runs: once the run on screen is ready, the rest are fetched at low priority (nearest
 * first, so J / Shift+J and the next click land on a loaded run), two at a time, and dropped the moment the suite is
 * left. Fetching itself goes through the replay query cache (queries.ts), so a prefetched switch is instant and the
 * cache's LRU cap bounds what stays parsed in memory.
 */

/**
 * The runs to preload, nearest first: next, previous, the one after next, and so on. At most `limit` of them: the
 * cache keeps only so many bundles, and one more would push an earlier, nearer one out.
 */
export function prefetchOrder(runIds: readonly string[], selected: string | undefined, limit: number): string[] {
  const at = selected === undefined ? -1 : runIds.indexOf(selected);
  if (at < 0 || limit <= 0) return [];
  const order: string[] = [];
  for (let distance = 1; distance < runIds.length && order.length < limit; distance++) {
    for (const index of [at + distance, at - distance]) {
      const id = runIds[index];
      if (id !== undefined && order.length < limit) order.push(id);
    }
  }
  return order;
}

export interface RunPrefetcherDeps {
  /** Loads `id` into the cache (resolves, or rejects, when done). */
  prefetch(id: string): Promise<unknown>;
  /** Stops an in-flight load that nothing on screen is waiting for. */
  cancel(id: string): void;
  /** Already loaded (or loading): nothing to do. */
  isCached(id: string): boolean;
  /** Most loads at once (2 by default). */
  concurrency?: number;
}

export class RunPrefetcher {
  private queue: string[] = [];
  private readonly inFlight = new Set<string>();
  private closed = false;

  private readonly deps: RunPrefetcherDeps;

  constructor(deps: RunPrefetcherDeps) {
    this.deps = deps;
  }

  /** Replaces what waits to load (loads already in flight carry on, and count against the two at a time). */
  schedule(ids: readonly string[]) {
    if (this.closed) return;
    this.queue = [...ids];
    this.pump();
  }

  /** Leaving the suite: nothing more starts, and loads nothing is waiting for are cancelled. */
  abort() {
    this.closed = true;
    this.queue = [];
    for (const id of this.inFlight) this.deps.cancel(id);
    this.inFlight.clear();
  }

  private pump() {
    const limit = this.deps.concurrency ?? 2;
    while (!this.closed && this.inFlight.size < limit) {
      const id = this.queue.shift();
      if (id === undefined) return;
      if (this.inFlight.has(id) || this.deps.isCached(id)) continue;
      this.inFlight.add(id);
      const done = () => {
        if (!this.inFlight.delete(id)) return;
        this.pump();
      };
      this.deps.prefetch(id).then(done, done);
    }
  }
}
