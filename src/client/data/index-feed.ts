import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { createCollection, useLiveQuery } from '@tanstack/react-db';
import { keepPreviousData, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';

import { matchesFilters, type ReplayFilters, type ReplaySummary } from '../../shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../../shared/review-suite.ts';
import { tagOptions } from '../index/feed.ts';
import { fetchIndexReplays, fetchIndexSuites, indexReplaysQuery, indexSuitesQuery } from '../index/index-queries.ts';
import { SignInError } from '../sign-in.tsx';
import { useHydrated } from './hydrated.ts';
import { collectionFamily } from './registry.ts';
import { wholeRows } from './write.ts';

/** Above this many rows in the base list, filters go back to the server (GET /api/replays has no pages). */
export const CLIENT_FILTER_MAX_ROWS = 5000;

const summariesFamily = collectionFamily((client, search) =>
  createCollection(
    wholeRows(
      queryCollectionOptions({
        id: `summaries:${search}`,
        queryClient: client,
        queryKey: indexReplaysQuery(search).queryKey,
        queryFn: ({ signal }) => fetchIndexReplays(search, signal),
        staleTime: 0,
        getKey: (summary: ReplaySummary) => summary.id,
      }),
    ),
  ),
);

const suitesFamily = collectionFamily((client, request) =>
  createCollection(
    wholeRows(
      queryCollectionOptions({
        id: `suites:${request}`,
        queryClient: client,
        queryKey: indexSuitesQuery(request).queryKey,
        queryFn: ({ signal }) => fetchIndexSuites(request, signal),
        staleTime: 0,
        getKey: (suite: ReviewSuiteIndexEntry) => suite.id,
      }),
    ),
  ),
);

/**
 * The index's replay summaries for one base search, as a collection over `['index', 'sessions', search]`: loaders, the
 * persisted cache and server-embedded data fill it.
 */
export function summariesCollection(client: QueryClient, search: string) {
  return summariesFamily(client, search);
}

/** The index's suites for one request, as a collection over `['index', 'suites', request]`. */
export function suitesCollection(client: QueryClient, request: string) {
  return suitesFamily(client, request);
}

export interface IndexListsInput {
  filters: ReplayFilters;
  /** What the server filters: For me and plugin params (`withForMe(searchFromFilters({ params }), forMe, linked)`). */
  baseSearch: string;
  /** Every filter, as the server would take it: the first paint of a filtered link, and lists too big to filter here. */
  listSearch: string;
  /** The suites request, with For me. */
  suitesRequest: string;
}

export interface IndexLists {
  /** Sessions matching every filter; undefined until a list for these filters is known. */
  items: ReplaySummary[] | undefined;
  suites: ReviewSuiteIndexEntry[] | undefined;
  /** Hosts and tags across the base list and the suites' runs (the filter menu's options). */
  hosts: string[];
  tags: string[];
  /** Filtering runs here, on the keystroke; false while the base list loads or when it is too big. */
  local: boolean;
  /** A request for the lists on screen is in flight (client-side filtering never sets it). */
  refreshing: boolean;
  error: Error | undefined;
  authFailure: SignInError | undefined;
}

const coreFilters = ({ params: _params, ...core }: ReplayFilters): ReplayFilters => core;
const hasCore = (filters: ReplayFilters) => Object.values(coreFilters(filters)).some((value) => value !== undefined && value !== '');

function menuOptions(base: readonly ReplaySummary[] | undefined, suites: readonly ReviewSuiteIndexEntry[] | undefined) {
  const runs = (suites ?? []).flatMap((suite) => suite.runDetails.flatMap((run) => (run.replay ? [run.replay] : [])));
  const all = [...(base ?? []), ...runs];
  return { hosts: [...new Set(all.map((summary) => summary.host).filter(Boolean))].sort(), tags: tagOptions(all).sort() };
}

/** The base list (For me, plugin params: what only the server filters) and, for big lists, the fully filtered one. */
function useSessionQueries(baseSearch: string, listSearch: string, filtering: boolean) {
  // why: a new base list (For me, a plugin filter) keeps the previous one on screen until it lands, never a skeleton.
  const base = useQuery({ ...indexReplaysQuery(baseSearch), placeholderData: keepPreviousData });
  const local = base.data !== undefined && base.data.length <= CLIENT_FILTER_MAX_ROWS;
  const server = useQuery({
    ...indexReplaysQuery(listSearch),
    enabled: filtering && listSearch !== baseSearch && !local,
    placeholderData: keepPreviousData,
  });
  return { base, server, local };
}

/** matchesFilters as a live query over the base list's collection; undefined until it is ready (or without one). */
function useLiveSessions(summaries: ReturnType<typeof summariesCollection> | undefined, filters: ReplayFilters, key: string) {
  const filtering = hasCore(filters);
  const live = useLiveQuery({
    query: (q) => {
      if (!summaries) return null;
      const all = q.from({ summary: summaries });
      return filtering ? all.fn.where(({ summary }) => matchesFilters(summary, filters)) : all;
    },
    queryKey: ['index-lists', key, Boolean(summaries), JSON.stringify(filters)],
  });
  return summaries && live.isReady ? live.data : undefined;
}

/**
 * Sessions matching every filter. The server answers For me and plugin filters (`x-*`), which only it can run: that is
 * the base list. Everything matchesFilters knows runs here as a live query over it; until the live query is ready (the
 * server's render, hydration, its first tick) the same answer comes from the cached base list.
 */
function useSessions({ filters, baseSearch, listSearch }: Omit<IndexListsInput, 'suitesRequest'>) {
  const client = useQueryClient();
  const hydrated = useHydrated();
  const core = coreFilters(filters);
  const filtering = hasCore(filters);
  const { base, server, local } = useSessionQueries(baseSearch, listSearch, filtering);
  const summaries = hydrated && local && !base.isPlaceholderData ? summariesCollection(client, baseSearch) : undefined;
  const liveItems = useLiveSessions(summaries, core, baseSearch);
  const cached = filtering ? base.data?.filter((summary) => matchesFilters(summary, core)) : base.data;
  const remote = filtering ? server.data : base.data;
  const serverError = local || !filtering ? base.error : (server.error ?? base.error);
  return {
    items: local ? (liveItems ?? cached) : remote,
    base: base.data,
    local,
    error: serverError ?? undefined,
    fetching: base.isFetching || server.isFetching,
    failures: [base.error, server.error],
  };
}

function useSuites(request: string) {
  const hydrated = useHydrated();
  const client = useQueryClient();
  const suites = useQuery({ ...indexSuitesQuery(request), placeholderData: keepPreviousData });
  const collection = hydrated && !suites.isPlaceholderData ? suitesCollection(client, request) : undefined;
  const live = useLiveQuery({
    query: (q) => (collection ? q.from({ suite: collection }) : null),
    queryKey: ['index-suites', request, Boolean(collection)],
  });
  const rows = collection && live.isReady ? live.data : suites.data;
  return { rows: rows ?? (suites.isError ? [] : undefined), data: suites.data, fetching: suites.isFetching, error: suites.error };
}

/** The index's sessions and suites, filtered live on the keystroke, plus the filter menu's options. */
export function useIndexLists({ filters, baseSearch, listSearch, suitesRequest }: IndexListsInput): IndexLists {
  const sessions = useSessions({ filters, baseSearch, listSearch });
  const suites = useSuites(suitesRequest);
  return {
    items: sessions.items,
    suites: suites.rows,
    ...menuOptions(sessions.base, suites.data),
    local: sessions.local,
    refreshing: sessions.fetching || suites.fetching,
    error: sessions.error,
    authFailure: [...sessions.failures, suites.error].find((reason): reason is SignInError => reason instanceof SignInError),
  };
}
