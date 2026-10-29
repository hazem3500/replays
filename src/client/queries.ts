import { fetchPage } from './sign-in.tsx';
import { QueryClient, type QueryCache, queryOptions } from '@tanstack/react-query';

import type { ReplayBundle } from '../shared/replay.ts';
import type { ClientConfig } from './config.ts';
import type { ReviewSuite, ReviewSuiteIndexRun } from '../shared/review-suite.ts';
import { readTextWithProgress } from './load-progress.ts';
import { rememberServedProfile } from './profiles.ts';
import { apiUrl } from './api/fetch.ts';

/*
 * The client's data cache (TanStack Query). Pages are separate documents (cross-document view
 * transitions), so this cache lives for one page: it serves the suite workspace's run switches and any
 * in-page revisit. Across pages the browser's HTTP cache does the work (uploaded bundles are
 * `private, max-age=86400, immutable`, src/server/app.ts) and Back restores the page from bfcache.
 */

/** `GET /api/suites/<id>?expand=runs`; servers without `expand` return the plain suite. */
export type SuiteWithRuns = ReviewSuite & { runDetails?: ReviewSuiteIndexRun[] };

/** A failed load; `status` is the HTTP status (absent for network and parse failures). */
export class LoadError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LoadError';
    this.status = status;
  }
}

/** Decoded JSON size per bundle (UTF-16 code units ≈ bytes for this ASCII-heavy JSON), for the cache cap. */
const decodedBytes = new WeakMap<object, number>();
export const bundleBytes = (bundle: unknown) => (bundle && typeof bundle === 'object' ? (decodedBytes.get(bundle) ?? 0) : 0);

type Priority = 'high' | 'low' | 'auto';

/**
 * `GET /api/replays/<id>`. Default cache mode and no extra headers, so it picks up index.html's
 * `<link rel=preload>` and an earlier hover prefetch from the browser's cache.
 */
export async function fetchReplay(id: string, signal?: AbortSignal, priority: Priority = 'auto'): Promise<ReplayBundle> {
  const response = await fetchPage(apiUrl(`replays/${encodeURIComponent(id)}`), {
    ...(signal ? { signal } : {}),
    ...(priority === 'auto' ? {} : { priority }),
  } as RequestInit);
  if (!response.ok)
    throw new LoadError(response.status === 404 ? 'Replay not found' : `Replay failed to load (${response.status})`, response.status);
  // The page's own load reports progress (the skeleton's hint); low-priority warm-ups stay quiet.
  const text = priority === 'low' ? await response.text() : await readTextWithProgress(response);
  let bundle: ReplayBundle;
  try {
    bundle = JSON.parse(text) as ReplayBundle;
  } catch {
    // A proxy or an old server can answer with an HTML page; say so instead of a JSON parser error.
    throw new LoadError('Replay failed to load (unexpected response)');
  }
  if (bundle && typeof bundle === 'object') decodedBytes.set(bundle, text.length);
  rememberServedProfile(id, response.headers.get('x-replay-profile') ?? response.headers.get('x-replay-purpose'));
  return bundle;
}

export async function fetchSuite(id: string, signal?: AbortSignal): Promise<SuiteWithRuns> {
  const response = await fetchPage(apiUrl(`suites/${encodeURIComponent(id)}?expand=runs`), signal ? { signal } : {});
  if (!response.ok)
    throw new LoadError(
      response.status === 404 ? 'Review suite not found' : `Review suite failed to load (${response.status})`,
      response.status,
    );
  return (await response.json()) as SuiteWithRuns;
}

/** Bundles are immutable once stored (the server refuses to overwrite an id), so they never go stale. */
export const replayQuery = (id: string) =>
  queryOptions({
    queryKey: ['replay', id] as const,
    meta: { ssr: false },
    queryFn: ({ signal }) => fetchReplay(id, signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
  });

/** Suites gain runs while a review runs: shown from cache at once, refreshed in the background. */
export const suiteQuery = (id: string) =>
  queryOptions({
    queryKey: ['suite', id] as const,
    queryFn: ({ signal }) => fetchSuite(id, signal),
    staleTime: 30_000,
  });

/** `GET /api/config`: one cache entry for every reader; a deployment's configuration does not change while a page is open. */
export const configQuery = queryOptions({
  queryKey: ['config'] as const,
  queryFn: async ({ signal }) => {
    const response = await fetch(apiUrl('config'), { signal });
    if (!response.ok) throw new Error(`Config failed to load (${response.status})`);
    return (await response.json()) as ClientConfig;
  },
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** `GET /api/me`'s session: whether a person is signed in, and where they sign out (when the auth mode has a way). */
export interface Account {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  session?: { signedIn: boolean; signOutUrl?: string };
}

/** `GET /api/me`: who is signed in; `null` when the server answers without one (401/403). */
export const meQuery = queryOptions({
  queryKey: ['me'] as const,
  queryFn: async ({ signal }) => {
    const response = await fetch(apiUrl('me'), { signal });
    if (!response.ok) return null;
    return (await response.json()) as Account;
  },
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** Warms a bundle at low network priority (a hover or keyboard visit on a suite run). */
export function prefetchReplay(client: QueryClient, id: string) {
  return client.prefetchQuery({ ...replayQuery(id), queryFn: ({ signal }) => fetchReplay(id, signal, 'low') });
}

export interface CacheLimits {
  /** Most bundles kept, including the ones on screen. */
  maxEntries: number;
  /** Most decoded JSON kept, in bytes. */
  maxBytes: number;
}

/** A bundle is up to ~20 MB of JSON (several times that once parsed): keep the last few, not every one opened. */
export const REPLAY_CACHE_LIMITS: CacheLimits = { maxEntries: 3, maxBytes: 60 * 1024 * 1024 };

export interface CachedBundle {
  hash: string;
  bytes: number;
  /** Larger is more recent. */
  lastUsed: number;
  /** On screen (has an observer): never evicted. */
  active: boolean;
}

/**
 * Which bundles to drop, least recently used first, until both limits hold. Bundles on screen and the
 * newest one (just loaded, or prefetched for the next view) are always kept, so the cap can run over
 * until a viewer lets go.
 */
export function bundlesToEvict(entries: readonly CachedBundle[], limits: CacheLimits): string[] {
  let count = entries.length;
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const evict: string[] = [];
  const ordered = entries.toSorted((a, b) => a.lastUsed - b.lastUsed);
  for (const entry of ordered.slice(0, -1)) {
    if (count <= limits.maxEntries && bytes <= limits.maxBytes) break;
    if (entry.active) continue;
    evict.push(entry.hash);
    count--;
    bytes -= entry.bytes;
  }
  return evict;
}

/**
 * Caps the `['replay', id]` queries: after each load, and when a viewer lets go of one, the least recently
 * used bundles beyond `limits` leave the cache (and become collectable) instead of waiting out gcTime.
 */
export function capReplayCache(cache: QueryCache, limits: CacheLimits = REPLAY_CACHE_LIMITS, sizeOf = bundleBytes) {
  let tick = 0;
  const used = new Map<string, number>();
  let scheduled = false;
  const enforce = () => {
    scheduled = false;
    const entries = cache
      .findAll({ queryKey: ['replay'] })
      .filter((query) => query.state.data !== undefined)
      .map((query) => ({
        hash: query.queryHash,
        bytes: sizeOf(query.state.data),
        lastUsed: used.get(query.queryHash) ?? 0,
        active: query.getObserversCount() > 0,
      }));
    for (const hash of bundlesToEvict(entries, limits)) {
      const query = cache.get(hash);
      if (query) cache.remove(query);
    }
  };
  // Removing queries while the cache is notifying is unsafe; run after the current batch.
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(enforce);
  };
  return cache.subscribe((event) => {
    if (event.query.queryKey[0] !== 'replay') return;
    const hash = event.query.queryHash;
    if (event.type === 'removed') used.delete(hash);
    else if (event.type === 'added' || event.type === 'observerAdded') used.set(hash, ++tick);
    else if (event.type === 'updated' && event.action.type === 'success') {
      used.set(hash, ++tick);
      schedule();
    } else if (event.type === 'observerRemoved') schedule();
  });
}

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Lists and suites: cached data renders at once and refreshes in the background (and when the window regains the keyboard).
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Errors show at once with a "Try again"; a 404 or a bad response will not fix itself on retry.
        retry: false,
      },
    },
  });
  capReplayCache(client.getQueryCache());
  return client;
}

export const queryClient = createQueryClient();
