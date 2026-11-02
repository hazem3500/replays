import { SignInError, SignInLink, fetchPage } from './sign-in.tsx';
import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatedText } from '@/components/animated-text.tsx';

import { PRODUCT_SLUG } from '../shared/brand.ts';
import { matchesFilters, type ReplayFilters, type ReplaySummary } from '../shared/replay.ts';
import {
  type ReviewSuiteIndexEntry,
  type ReviewSuiteIndexRun,
  type SuiteOverallStatus,
  suiteOverallStatus,
} from '../shared/review-suite.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { SwitchIconButton } from '@/components/icon-button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select.tsx';
import { cn } from '@/lib/utils.ts';

import { productName } from './config.ts';
import { useIndexLists } from './data/index-feed.ts';
import { useAutoRetry } from './hooks/use-auto-retry.ts';
import { useShownLists } from './hooks/use-shown-lists.ts';
import { Feed, type FeedView } from './index/Feed.tsx';
import { FeedReveal, FeedSkeleton } from './index/FeedSkeleton.tsx';
import { knownShape, rememberShape } from './index/index-cache.ts';
import { indexReplaysQuery, indexSuitesQuery } from './index/index-queries.ts';
import { RefreshLine, ScopeCount } from './index/ScopeCount.tsx';
import { feedTransition, staggerIn } from './index/feed-transition.ts';
import { rememberListed } from './navigation.ts';
import { CommandSearch, IndexIdentity, type PurposeCounts, PurposeSegments, ScopeBar } from './index/IndexHeader.tsx';
import { pagePurposes } from './purposes.ts';
import { useMediaQuery } from './media.ts';
import { SortMenu } from './ReplayIndexCompact.tsx';
import { FirstRun } from './index/first-run/FirstRun.tsx';
import { activeFilterTokens, FilterMenu, FilterSheet, type LinkableHandle } from './index/FilterMenu.tsx';
import { IndexEmpty, type IndexEmptyInput } from './index/index-empty.tsx';
import { usePluginSnapshot } from './plugins/PluginUi.tsx';
import { MeContext } from './index/People.tsx';
import { IndexSections } from './index/PluginSlots.tsx';
import { apiUrl, rememberIndexSearch } from './route.ts';
import { readStorage, writeStorage } from './storage.ts';
import { sourceText } from './index/SourceLine.tsx';
import { playableReplayId } from './suite/runs.ts';
import { Topbar } from './Topbar.tsx';
import { UploadReplay, type UploadReplayHandle } from './upload/UploadReplay.tsx';
import { useReplayDrop } from './upload/useReplayDrop.tsx';

export type SortKey = 'title' | 'host' | 'capturedAt' | 'duration' | 'steps' | 'errors';
export interface Sort {
  key: SortKey;
  direction: 'ascending' | 'descending';
}

/** Sortable fields and their names (the sort menu, and `?sort=` validation). */
export const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'title', label: 'Title' },
  { key: 'host', label: 'Host' },
  { key: 'capturedAt', label: 'Captured' },
  { key: 'duration', label: 'Duration', numeric: true },
  { key: 'steps', label: 'Steps', numeric: true },
  { key: 'errors', label: 'Errors', numeric: true },
];

/** Plugin filter params (registerIndexFilter / api.indexFilter): the same rule as the server's. */
const PLUGIN_PARAM = /^x-[a-z0-9][a-z0-9-]{0,38}$/;

/** True when a plugin filter is set: those are matched only by the server. */
const hasPluginFilters = (filters: ReplayFilters) => Object.keys(filters.params ?? {}).length > 0;

export function filtersFromSearch(search: string): ReplayFilters {
  const params = new URLSearchParams(search);
  const filters: ReplayFilters = {};
  const q = params.get('q');
  if (q) filters.q = q;
  const host = params.get('host');
  if (host) filters.host = host;
  if (params.get('errors') === '1') filters.errors = true;
  const source = params.get('source');
  if (source === 'agent' || source === 'human') filters.source = source;
  const tag = params.get('tag');
  if (tag) filters.tag = tag;
  // Plugin filters (`x-*`, registerIndexFilter): carried as they are, before or without the plugin's entry; the server matches.
  const plugin: Record<string, string> = {};
  for (const [key, value] of params)
    if (PLUGIN_PARAM.test(key) && value.trim() && !(key in plugin)) plugin[key] = value.trim().slice(0, 200);
  if (Object.keys(plugin).length) filters.params = plugin;
  return filters;
}

export function searchFromFilters(filters: ReplayFilters) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.host) params.set('host', filters.host);
  if (filters.errors) params.set('errors', '1');
  if (filters.source) params.set('source', filters.source);
  if (filters.tag) params.set('tag', filters.tag);
  for (const key of Object.keys(filters.params ?? {}).sort()) params.set(key, filters.params![key]!);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Which kinds of row the index shows; kept in the URL as `kind=`, client-side only. */
export type IndexKind = 'suites' | 'sessions';

export function kindFromSearch(search: string): IndexKind | undefined {
  const kind = new URLSearchParams(search).get('kind');
  return kind === 'suites' || kind === 'sessions' ? kind : undefined;
}

/** "For me" (`for=me`): only rows whose people include the signed-in person; kept in the URL like `kind=`. */
export function forMeFromSearch(search: string) {
  return new URLSearchParams(search).get('for') === 'me';
}

/**
 * The query the server filters For me by: `for=me` plus the handles linked in this browser (`handle.<id>=value`),
 * appended to a request path that may already have a query. Unchanged when For me is off.
 */
export function withForMe(path: string, forMe: boolean, linked: Readonly<Record<string, string>> = {}) {
  if (!forMe) return path;
  const params = new URLSearchParams({ for: 'me' });
  for (const [id, value] of Object.entries(linked).sort(([a], [b]) => a.localeCompare(b))) if (value) params.set(`handle.${id}`, value);
  return `${path}${path.includes('?') ? '&' : '?'}${params}`;
}

const LINKED_KEY = `${PRODUCT_SLUG}-linked-handles`;

/** The handles this browser linked for For me (`{ github: 'octocat' }`), from localStorage. */
export function storedLinkedHandles(): Record<string, string> {
  try {
    const value = JSON.parse(readStorage(LINKED_KEY) ?? '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])),
    );
  } catch {
    return {};
  }
}

/** `GET /api/me`: the signed-in identity, plus the deployment's people config when it has one. */
interface Me {
  id: string;
  email?: string;
  people?: { roles?: string[]; handles: LinkableHandle[] };
}

/** The index's suites request; index.html preloads the same URL (keep the two in step). */
export const INDEX_SUITES_URL = 'suites?expand=runs&limit=100';

/** At or below this width the index is a list, not a table; styles.css keys its compact rules off the same query. */
export const INDEX_COMPACT_QUERY = '(max-width: 640px)';

export const DEFAULT_SORT: Sort = { key: 'capturedAt', direction: 'descending' };
const SORT_KEYS = new Set<string>(COLUMNS.map((column) => column.key));

/** `sort=errors` (ascending) or `sort=-errors` (descending); client-side only, absent for the default. */
export function sortFromSearch(search: string): Sort {
  const raw = new URLSearchParams(search).get('sort') ?? '';
  const key = raw.replace(/^-/, '');
  if (!SORT_KEYS.has(key)) return DEFAULT_SORT;
  return { key: key as SortKey, direction: raw.startsWith('-') ? 'descending' : 'ascending' };
}

/** The purpose segment, `purpose=`: one of the deployment's purposes, else none (All). */
export function purposeFromSearch(search: string, purposes = pagePurposes()): string | undefined {
  const purpose = new URLSearchParams(search).get('purpose');
  return purposes.some((item) => item.id === purpose) ? purpose! : undefined;
}

/** The purposes an entry counts under: a replay's own; a suite's, those of its runs' replays. */
export function entryPurposes(entry: IndexEntry): string[] {
  if (entry.kind === 'session') return entry.summary.purpose ? [entry.summary.purpose] : [];
  return [...new Set(entry.suite.runDetails.flatMap((run) => (run.replay?.purpose ? [run.replay.purpose] : [])))];
}

/** Entries per purpose segment. The segments narrow the list after the other filters, so every tab shows its count. */
export function purposeCounts(entries: readonly IndexEntry[]): PurposeCounts {
  const counts: PurposeCounts = { all: entries.length };
  for (const entry of entries) for (const purpose of entryPurposes(entry)) counts[purpose] = (counts[purpose] ?? 0) + 1;
  return counts;
}

export function indexSearch(
  filters: ReplayFilters,
  kind: IndexKind | undefined,
  sort: Sort = DEFAULT_SORT,
  purposeOrForMe?: string | boolean,
  forMe = false,
) {
  const purpose = typeof purposeOrForMe === 'string' ? purposeOrForMe : undefined;
  if (typeof purposeOrForMe === 'boolean') forMe = purposeOrForMe;
  const params = new URLSearchParams(searchFromFilters(filters));
  if (purpose) params.set('purpose', purpose);
  if (kind) params.set('kind', kind);
  if (forMe) params.set('for', 'me');
  if (sort.key !== DEFAULT_SORT.key || sort.direction !== DEFAULT_SORT.direction)
    params.set('sort', `${sort.direction === 'descending' ? '-' : ''}${sort.key}`);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** What the index keeps in its history entry so the back button returns to the same view. */
interface IndexHistoryState {
  indexScroll?: number;
}

const VIEW_KEY = `${PRODUCT_SLUG}-index-view`;

/** List or grid, remembered per browser; phones always get the list. */
export function storedView(): FeedView {
  return readStorage(VIEW_KEY) === 'grid' ? 'grid' : 'list';
}

function indexHistoryState(): IndexHistoryState {
  return (history.state ?? {}) as IndexHistoryState;
}

function patchIndexHistoryState(patch: IndexHistoryState) {
  history.replaceState({ ...history.state, ...patch }, '');
}

export function errorCount(summary: ReplaySummary) {
  return summary.consoleErrors + summary.failedRequests;
}

export function sortSummaries(items: ReplaySummary[], sort: Sort) {
  const value = (summary: ReplaySummary): string | number => (sort.key === 'errors' ? errorCount(summary) : summary[sort.key]);
  const factor = sort.direction === 'ascending' ? 1 : -1;
  return items.toSorted((a, b) => {
    const left = value(a);
    const right = value(b);
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return order * factor || b.capturedAt.localeCompare(a.capturedAt);
  });
}

interface SortValues {
  title: string;
  host: string;
  capturedAt: string;
  duration: number;
  steps: number;
  errors: number;
}

export type IndexEntry =
  | { kind: 'session'; id: string; summary: ReplaySummary; values: SortValues }
  | {
      kind: 'suite';
      id: string;
      suite: ReviewSuiteIndexEntry;
      status: SuiteOverallStatus;
      /** Runs that match the filters, in sequence order (all of them when the suite itself matches). */
      runs: ReviewSuiteIndexRun[];
      hiddenRuns: number;
      /** True when the suite's own title or subject matched, rather than one of its runs. */
      matchedBySuite: boolean;
      hosts: string[];
      consoleErrors: number;
      failedRequests: number;
      values: SortValues;
    };

function runMatches(run: ReviewSuiteIndexRun, filters: ReplayFilters, query: string, matched?: ReadonlySet<string>) {
  const { q: _q, params: _params, ...rest } = filters;
  // With plugin filters on, a run matches when the server listed its replay (the server alone can run plugin filters).
  if (matched && !(run.replayId && matched.has(run.replayId))) return false;
  if (run.replay ? !matchesFilters(run.replay, rest) : Boolean(rest.host || rest.tag || rest.errors || rest.source === 'human'))
    return false;
  return !query || run.label.toLowerCase().includes(query) || Boolean(run.replay && matchesFilters(run.replay, { q: query }));
}

function suiteEntry(
  suite: ReviewSuiteIndexEntry,
  filters: ReplayFilters,
  matched?: ReadonlySet<string>,
): Extract<IndexEntry, { kind: 'suite' }> | undefined {
  const query = filters.q?.trim().toLowerCase() ?? '';
  const all = suite.runDetails.toSorted((a, b) => a.sequence - b.sequence);
  const text = [suite.title, suite.id, suite.subject ? sourceText(suite.subject) : ''];
  const matchedBySuite =
    !filters.host &&
    !filters.tag &&
    !filters.errors &&
    filters.source !== 'human' &&
    !matched &&
    (!query || text.some((value) => value.toLowerCase().includes(query)));
  const runs = matchedBySuite ? all : all.filter((run) => runMatches(run, filters, query, matched));
  if (!matchedBySuite && runs.length === 0) return undefined;
  const replays = all.flatMap((run) => (run.replay ? [run.replay] : []));
  const sum = (pick: (replay: ReplaySummary) => number) => replays.reduce((total, replay) => total + pick(replay), 0);
  const hosts = [...new Set(replays.map((replay) => replay.host).filter(Boolean))].sort();
  const consoleErrors = sum((replay) => replay.consoleErrors);
  const failedRequests = sum((replay) => replay.failedRequests);
  return {
    kind: 'suite',
    id: suite.id,
    suite,
    status: suiteOverallStatus(all),
    runs,
    hiddenRuns: all.length - runs.length,
    matchedBySuite,
    hosts,
    consoleErrors,
    failedRequests,
    values: {
      title: suite.title,
      host: hosts[0] ?? '',
      capturedAt: suite.createdAt,
      duration: sum((replay) => replay.duration),
      steps: sum((replay) => replay.steps),
      errors: consoleErrors + failedRequests,
    },
  };
}

/**
 * One list for both kinds of row. Sessions arrive already filtered by the server;
 * suites are filtered here: a suite stays when it, or any of its runs, matches.
 * Replays recorded for a suite run are listed only under that suite.
 */
export function buildIndexEntries(
  sessions: ReplaySummary[],
  suites: ReviewSuiteIndexEntry[],
  filters: ReplayFilters,
  kind?: IndexKind,
): IndexEntry[] {
  const inSuites = new Set(suites.flatMap((suite) => suite.runDetails.flatMap((run) => (run.replayId ? [run.replayId] : []))));
  const entries: IndexEntry[] = [];
  const matched = hasPluginFilters(filters) ? new Set(sessions.map((summary) => summary.id)) : undefined;
  if (kind !== 'sessions') {
    for (const suite of suites) {
      const entry = suiteEntry(suite, filters, matched);
      if (entry) entries.push(entry);
    }
  }
  if (kind !== 'suites') {
    for (const summary of sessions) {
      if (inSuites.has(summary.id)) continue;
      entries.push({ kind: 'session', id: summary.id, summary, values: { ...summary, errors: errorCount(summary) } });
    }
  }
  return entries;
}

export function sortEntries(entries: IndexEntry[], sort: Sort) {
  const factor = sort.direction === 'ascending' ? 1 : -1;
  return entries.toSorted((a, b) => {
    const left = a.values[sort.key];
    const right = b.values[sort.key];
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return order * factor || b.values.capturedAt.localeCompare(a.values.capturedAt);
  });
}

/** Replays the list shows: top-level sessions plus recorded (unexpired) runs of the listed suites. */
export function replayCount(entries: IndexEntry[]) {
  return entries.reduce(
    (total, entry) => total + (entry.kind === 'session' ? 1 : entry.runs.filter((run) => playableReplayId(run, true)).length),
    0,
  );
}

export function ReplayIndex() {
  const [filters, setFilters] = useState<ReplayFilters>(() => filtersFromSearch(location.search));
  const [forMe, setForMe] = useState(() => forMeFromSearch(location.search));
  const [linked, setLinked] = useState(storedLinkedHandles);
  const [me, setMe] = useState<Me>();
  /** The sessions request (and the Back cache's key): the filters, plus For me. */
  const listSearch = withForMe(searchFromFilters(filters), forMe, linked);
  const suitesRequest = withForMe(INDEX_SUITES_URL, forMe, linked);
  /** What the server filters (For me, plugin params); everything else runs here, on the keystroke (data/index-feed.ts). */
  const baseSearch = withForMe(searchFromFilters(filters.params ? { params: filters.params } : {}), forMe, linked);
  const queryClient = useQueryClient();
  /** The whole feed came from the cache (persisted, preloaded or this tab's): it is simply there (no entrance), and only revalidates. */
  const [instant] = useState(() =>
    Boolean(
      (queryClient.getQueryData(indexReplaysQuery(baseSearch).queryKey) ?? queryClient.getQueryData(indexReplaysQuery(listSearch).queryKey)) &&
        queryClient.getQueryData(indexSuitesQuery(suitesRequest).queryKey),
    ),
  );
  const [kind, setKind] = useState<IndexKind | undefined>(() => kindFromSearch(location.search));
  const purposes = pagePurposes();
  const [purpose, setPurpose] = useState<string | undefined>(() => purposeFromSearch(location.search, purposes));
  const [query, setQuery] = useState(filters.q ?? '');
  const [meFailure, setAuthFailure] = useState<SignInError>();
  const [sort, setSort] = useState<Sort>(() => sortFromSearch(location.search));
  // The lists as collections (filters live, on the keystroke), then what the feed shows: a server change for the same
  // view moves in place, and new arrivals glow (data/index-shown.ts). Suites stay undefined until first known, so
  // suite replays never flash as sessions.
  const lists = useIndexLists({ filters, baseSearch, listSearch, suitesRequest });
  const { items, suites } = useShownLists(lists, listSearch);
  const { hosts, tags } = lists;
  const authFailure = meFailure ?? lists.authFailure;
  const loadError = lists.error
    ? lists.error instanceof TypeError
      ? `Could not reach ${productName()}. Check your connection.`
      : lists.error.message
    : '';
  const [preferredView, setPreferredView] = useState<FeedView>(storedView);
  // Phones get a sort menu and a filter sheet instead of the row of selects (same URL state), and always the list.
  const compact = useMediaQuery(INDEX_COMPACT_QUERY);
  const view: FeedView = compact ? 'list' : preferredView;
  const toolbar = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const upload = useRef<UploadReplayHandle>(null);
  // Drop a replay.json or rrweb export anywhere on the index to upload it.
  const dropOverlay = useReplayDrop((file) => upload.current?.open(file));

  useEffect(() => {
    document.title = productName();
  }, []);

  // Typing filters on the keystroke when the list is here; when the server filters (a big list), it waits for a pause.
  const type = (value: string) => {
    setQuery(value);
    // The field updates at once; the feed follows in a transition, so a long list never holds up the next key.
    if (lists.local)
      startTransition(() =>
        setFilters((current) => (current.q === (value || undefined) ? current : withFilter(current, 'q', value || undefined))),
      );
  };
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilters((current) => (current.q === (query || undefined) ? current : withFilter(current, 'q', query || undefined))),
      200,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const search = indexSearch(filters, kind, sort, purpose, forMe);
    history.replaceState(history.state, '', `${location.pathname}${search}`);
    rememberIndexSearch(search);
  }, [filters, kind, sort, purpose, forMe]);

  // Who "me" is, and which handles the deployment lets a person link (used only where people exist).
  useEffect(() => {
    const controller = new AbortController();
    fetchPage(apiUrl('me'), { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Me) : undefined))
      .then((loaded) => {
        if (loaded && typeof loaded === 'object') setMe(loaded);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && reason instanceof SignInError) setAuthFailure(reason);
        // Without it the index still works: no "That's you", and For me still matches by email on the server.
      });
    return () => controller.abort();
  }, []);

  // Back from a replay lands where you left: the scroll offset lives in this history entry.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => patchIndexHistoryState({ indexScroll: Math.round(window.scrollY) }));
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', save);
    };
  }, []);

  // The header block sticks; day headings stick right under it, and summary jumps stop there too.
  useLayoutEffect(() => {
    const host = shell.current;
    const block = toolbar.current;
    if (!host || !block) return;
    const measure = () => host.style.setProperty('--feed-sticky-top', `${Math.round(block.offsetHeight)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(block);
    return () => observer.disconnect();
  }, []);

  const unsegmented = useMemo(
    () => (items && suites ? sortEntries(buildIndexEntries(items, suites, filters, kind), sort) : undefined),
    [items, suites, filters, kind, sort],
  );
  // The purpose segment narrows what the other filters keep (client-side, so every tab can show its count).
  const counts = useMemo(() => (purposes.length && unsegmented ? purposeCounts(unsegmented) : undefined), [purposes, unsegmented]);
  const entries = useMemo(
    () => (purpose && unsegmented ? unsegmented.filter((entry) => entryPurposes(entry).includes(purpose)) : unsegmented),
    [unsegmented, purpose],
  );
  const listed = Boolean(entries);
  // Effects re-run when the index is shown again behind a viewer page (App.tsx keeps it in an Activity).
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (!listed) return;
    const top = indexHistoryState().indexScroll;
    if (top) window.scrollTo(0, top);
    // A fresh visit: the first items rise in. Back from a replay: the feed is simply there, where you left it.
    if (!instant && !entered.current && shell.current) staggerIn(shell.current);
    entered.current = true;
  }, [listed, instant]);
  // What a card opens is known before its bundle loads: the viewer's skeleton takes its shape (navigation.ts).
  useEffect(() => {
    if (items) rememberListed(items);
    for (const suite of suites ?? []) rememberListed((suite.runDetails ?? []).flatMap((run) => (run.replay ? [run.replay] : [])));
  }, [items, suites]);
  const filtered = Boolean(
    filters.q || filters.host || filters.tag || filters.errors || filters.source || kind || purpose || forMe || hasPluginFilters(filters),
  );
  // People UI (For me, avatar stacks) only where people exist: the deployment registered them, or the list has some.
  const peopleOn =
    forMe ||
    Boolean(me?.people) ||
    Boolean(items?.some((summary) => summary.people?.length)) ||
    Boolean(suites?.some((suite) => suite.people?.length || suite.runDetails.some((run) => run.replay?.people?.length)));
  const meContext = useMemo(() => ({ ...(me?.email ? { email: me.email } : {}), handles: linked }), [me, linked]);
  const pending = lists.refreshing || query !== (filters.q ?? '') || !suites;
  const error = items ? '' : loadError;
  // why: a proxy in front of a stopped server answers 502–504; for the person that is "can't reach", not a server bug.
  const unreachable = lists.error instanceof TypeError || /\((?:502|503|504)\)$/.test(lists.error?.message ?? '');
  // why: a saved list (the persisted cache) beats a blank page; say it may be stale and keep trying.
  const stale = Boolean(items && lists.error) && !authFailure;
  const autoRetry = useAutoRetry({
    failing: Boolean(lists.error) && !authFailure,
    pending: lists.refreshing,
    retry: () => void queryClient.refetchQueries({ queryKey: ['index'], type: 'active' }),
  });
  const replays = entries ? replayCount(entries) : 0;
  const suiteRows = entries ? entries.filter((entry) => entry.kind === 'suite').length : 0;

  // Feed changes cross-fade (feed-transition.ts).
  const changeSort = (next: Sort) => feedTransition(() => setSort(next));
  const changeKind = (next: IndexKind | undefined) => feedTransition(() => setKind(next));
  const changePurpose = (next: string | undefined) => feedTransition(() => setPurpose(next));
  const update = <K extends keyof ReplayFilters>(key: K, value: ReplayFilters[K] | undefined) =>
    feedTransition(() => setFilters((current) => withFilter(current, key, value)));
  /** A plugin filter's `x-*` param (registerIndexFilter); undefined or '' removes it. */
  const setParam = (param: string, value: string | undefined) =>
    feedTransition(() =>
      setFilters((current) => {
        const params = { ...current.params };
        if (value?.trim()) params[param] = value.trim().slice(0, 200);
        else delete params[param];
        return withFilter(current, 'params', Object.keys(params).length ? params : undefined);
      }),
    );
  const clear = () => {
    setQuery('');
    setKind(undefined);
    setPurpose(undefined);
    setForMe(false);
    setFilters({});
  };
  /** The sheet's "Clear all": every filter except the search text. */
  const clearFilters = () =>
    feedTransition(() => {
      setKind(undefined);
      setForMe(false);
      setFilters((current) => (current.q ? { q: current.q } : {}));
    });
  // For me and the linked handles change the sessions request: a fresh `filters` object re-runs it (and its pending state).
  const changeForMe = (next: boolean) =>
    feedTransition(() => {
      setForMe(next);
      setFilters((current) => ({ ...current }));
    });
  const changeLinked = (id: string, value: string) => {
    const next = { ...linked };
    if (value) next[id] = value;
    else delete next[id];
    writeStorage(LINKED_KEY, JSON.stringify(next));
    setLinked(next);
    if (forMe) setFilters((current) => ({ ...current }));
  };
  const chooseView = (next: FeedView) => {
    if (next !== preferredView) feedTransition(() => setPreferredView(next), 'poster');
    writeStorage(VIEW_KEY, next);
  };
  const searchField = <CommandSearch value={query} onChange={type} entries={entries} total={entries?.length} compact={compact} />;
  // The count stays on screen through refreshes (ScopeCount); the header's hairline shows a refresh past 300 ms.
  const refreshing = Boolean(entries) && !error && lists.refreshing;
  const count = (
    <ScopeCount
      replays={entries ? replays : undefined}
      suites={suiteRows}
      shown={filtered}
      state={error ? 'error' : !entries ? 'loading' : refreshing ? 'updating' : 'ready'}
    />
  );
  // How this exact view (filters, kind, purpose) looked: the next skeleton for it draws as many entries, with the
  // room a leading suite stack peeks into.
  const viewKey = `${listSearch}|${kind ?? ''}|${purpose ?? ''}`;
  useEffect(() => {
    if (entries && !pending && !error)
      rememberShape(viewKey, { count: entries.length, leadingSuite: entries.slice(0, 4).some((entry) => entry.kind === 'suite') });
  }, [entries, pending, error, viewKey]);
  const filterState = {
    filters,
    kind,
    hosts,
    tags,
    update,
    setParam,
    setKind: changeKind,
    clearFilters,
    ...(peopleOn ? { forMe, setForMe: changeForMe, handles: me?.people?.handles ?? [], linked, setLinked: changeLinked } : {}),
  };
  // why: an empty view names what narrowed it (purpose first, then each filter) so the way back is obvious.
  const pluginFilters = usePluginSnapshot().filters;
  const purposeInfo = purpose ? purposes.find((item) => item.id === purpose) : undefined;
  const narrowing = [
    ...(purposeInfo ? [purposeInfo.label] : []),
    ...activeFilterTokens(filterState, pluginFilters).map((token) => token.name),
  ];
  const searchText = filters.q?.trim() ?? '';
  const emptyView: IndexEmptyInput | undefined =
    !entries || entries.length > 0
      ? undefined
      : searchText
        ? {
            kind: 'search',
            query: searchText,
            narrowing,
            onClearSearch: () => type(''),
            onSearchEverything: () =>
              feedTransition(() => {
                setKind(undefined);
                setForMe(false);
                setPurpose(undefined);
                setFilters((current) => (current.q ? { q: current.q } : {}));
              }),
          }
        : purposeInfo && narrowing.length === 1
          ? { kind: 'purpose', purpose: purposeInfo, onShowAll: () => changePurpose(undefined) }
          : filtered
            ? { kind: 'filtered', active: narrowing, onClearFilters: clear }
            : undefined;

  return (
    <main className="index-shell" ref={shell}>
      {/* One sticky block: identity + search + actions, then the toolbar (purposes, active filters, filter, sort, layout). */}
      <div ref={toolbar} className="index-head">
        <Topbar
          root={<IndexIdentity />}
          actions={
            <>
              {searchField}
              <UploadReplay ref={upload} compact />
            </>
          }
        />
        {/* One toolbar row: purpose tabs on the left; active filters (desktop), Filter, sort and layout on the right. */}
        <ScopeBar
          count={count}
          lead={purposes.length ? <PurposeSegments purposes={purposes} value={purpose} counts={counts} onChange={changePurpose} /> : undefined}
        >
          {compact ? <FilterSheet {...filterState} /> : <FilterMenu {...filterState} />}
          <SortMenu sort={sort} onChange={changeSort} />
          {compact ? null : (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a group of two flips, not a fieldset.
            <div className="view-switch" role="group" aria-label="Layout">
              <SwitchIconButton label="List" pressed={view === 'list'} onPressedChange={() => chooseView('list')}>
                <AnimatedIcon name="list" />
              </SwitchIconButton>
              <SwitchIconButton label="Grid" pressed={view === 'grid'} onPressedChange={() => chooseView('grid')}>
                <AnimatedIcon name="layout-grid" />
              </SwitchIconButton>
            </div>
          )}
        </ScopeBar>
        <RefreshLine active={refreshing} />
      </div>

      <section className="index-body" aria-label="Replays" aria-busy={pending}>
        {/* Plugins' blocks above the list (registerIndexSection), given what the list shows. */}
        {items && !error ? <IndexSections summaries={items} /> : null}
        {authFailure ? <SignInLink error={authFailure} /> : null}
        {stale ? <IndexEmpty input={{ kind: 'offline', connection: unreachable, retry: autoRetry }} /> : null}
        {/* The skeleton (as many placeholders as this view last showed) hands over to what arrives (FeedSkeleton.tsx). */}
        <FeedReveal
          loading={!error && !entries}
          skeleton={<FeedSkeleton view={view} grouped={sort.key === 'capturedAt'} known={knownShape(viewKey)} />}
        >
          {error ? (
            <IndexEmpty input={{ kind: 'error', product: productName(), connection: unreachable, reason: error, retry: autoRetry }} />
          ) : emptyView ? (
            <IndexEmpty input={emptyView} onUpload={() => upload.current?.open()} />
          ) : entries && entries.length === 0 ? (
            <FirstRun onUpload={() => upload.current?.open()} purposes={purposes} />
          ) : entries ? (
            <MeContext value={meContext}>
              <Feed entries={entries} view={view} grouped={sort.key === 'capturedAt'} query={filters.q?.trim() ?? ''} />
            </MeContext>
          ) : null}
        </FeedReveal>
      </section>
      {dropOverlay}
    </main>
  );
}

/**
 * A compact filter: one trigger that reads "Host" while unset and "Host · 127.0.0.1" once set,
 * opening a listbox (shadcn Select over Base UI). Value lives in the URL like every other filter.
 */
export function FilterSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
  bare,
}: {
  label: string;
  allLabel: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T | undefined) => void;
  className?: string;
  /** Show only the value ("All hosts", "example.com"); for places that label the control themselves. */
  bare?: boolean;
}) {
  const items: Array<{ value: T | null; label: string }> = [{ value: null, label: allLabel }, ...options];
  const current = options.find((option) => option.value === value);
  return (
    <Select items={items} value={value ?? null} onValueChange={(next) => onChange((next ?? undefined) as T | undefined)}>
      <SelectTrigger
        aria-label={`${label}: ${current?.label ?? allLabel}`}
        data-active={current ? '' : undefined}
        className={cn(
          'filter-trigger h-[30px] max-w-[220px] gap-1.5 border-[var(--line)] bg-transparent px-2 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] data-active:border-[var(--line-strong)] data-active:text-[var(--text)] dark:bg-transparent dark:hover:bg-[var(--surface-hover)]',
          className,
        )}
      >
        {bare ? (
          <AnimatedText className="min-w-0 truncate" text={current?.label ?? allLabel} />
        ) : (
          <>
            <span>{label}</span>
            {current ? <AnimatedText className="filter-value" text={current.label} /> : null}
          </>
        )}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="w-auto min-w-40">
        {items.map((item) => (
          <SelectItem key={item.value ?? ''} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function withFilter<K extends keyof ReplayFilters>(filters: ReplayFilters, key: K, value: ReplayFilters[K] | undefined): ReplayFilters {
  const next = { ...filters };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  return next;
}

