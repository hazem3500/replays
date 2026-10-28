import { queryOptions } from '@tanstack/react-query';
import type * as z from 'zod/mini';

import type { ReplaySummary } from '../../shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../../shared/review-suite.ts';
import { replaySummaryListSchema, suiteIndexListSchema } from '../../shared/schemas/replay.ts';
import { apiUrl } from '../route.ts';
import { fetchPage } from '../sign-in.tsx';

/** Long enough to outlive a visit to a replay and back; the lists are revalidated on every use anyway. */
const INDEX_GC_MS = 60 * 60_000;

async function fetchList<T>(url: string, label: string, schema: z.ZodMiniType<T>, signal?: AbortSignal) {
  const response = await fetchPage(apiUrl(url), signal ? { signal } : {});
  if (!response.ok) throw new Error(`${label} failed to load (${response.status})`);
  return schema.parse(await response.json());
}

/**
 * `GET /api/replays<search>`: `search` is ReplayIndex's `listSearch` ('' or '?…': the filters plus For me), exactly
 * what index.html preloads.
 */
export const fetchIndexReplays = (search: string, signal?: AbortSignal) =>
  fetchList<ReplaySummary[]>(`replays${search}`, 'Replays', replaySummaryListSchema, signal);
/** `GET /api/<request>`: the suites URL with For me (`suites?expand=runs&limit=100…`). */
export const fetchIndexSuites = (request: string, signal?: AbortSignal) =>
  fetchList<ReviewSuiteIndexEntry[]>(request, 'Review suites', suiteIndexListSchema, signal);

/** The index's session lists under `['index', 'sessions', search]` (INDEX_SESSIONS_KEY + search). */
export const INDEX_SESSIONS_KEY = ['index', 'sessions'] as const;

export const indexReplaysQuery = (search: string) =>
  queryOptions({
    queryKey: [...INDEX_SESSIONS_KEY, search] as const,
    queryFn: ({ signal }) => fetchIndexReplays(search, signal),
    staleTime: 0,
    gcTime: INDEX_GC_MS,
  });

export const indexSuitesQuery = (request: string) =>
  queryOptions({
    queryKey: ['index', 'suites', request] as const,
    queryFn: ({ signal }) => fetchIndexSuites(request, signal),
    staleTime: 0,
    gcTime: INDEX_GC_MS,
  });

export { persistIndexQueries } from '../data/persist.ts';
