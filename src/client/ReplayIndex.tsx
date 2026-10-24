import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { Button } from '@/components/ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select.tsx';
import { cn } from '@/lib/utils.ts';

import { copyText } from './clipboard.ts';
import { productName } from './config.ts';
import { Feed, type FeedView, FeedSkeleton } from './index/Feed.tsx';
import { tagOptions } from './index/feed.ts';
import { feedTransition, staggerIn } from './index/feed-transition.ts';
import { rememberListed } from './navigation.ts';
import { CommandSearch, IndexIdentity, type PurposeCounts, PurposeSegments, ScopeBar } from './index/IndexHeader.tsx';
import { pagePurposes } from './purposes.ts';
import { useMediaQuery } from './media.ts';
import { CompactFilterChips, SortMenu } from './ReplayIndexCompact.tsx';
import { FilterMenu, FilterSheet, type LinkableHandle } from './index/FilterMenu.tsx';
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

/** The last list this tab showed, so Back from a replay renders the feed at once (and at its scroll offset). */
const INDEX_CACHE_KEY = `${PRODUCT_SLUG}-index-cache`;
const INDEX_CACHE_MAX = 1_500_000;

interface IndexCache {
  search: string;
  items: ReplaySummary[];
  suites: ReviewSuiteIndexEntry[];
  /** Newest capturedAt this tab has listed: anything newer on a refresh is new (and glows). */
  newest?: string;
}

/** On Back/Forward only: the cached list for this request (a fresh visit always starts from the server). */
function restoredIndex(search: string): IndexCache | undefined {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type !== 'back_forward') return undefined;
  try {
    const cache = JSON.parse(sessionStorage.getItem(INDEX_CACHE_KEY) ?? 'null') as IndexCache | null;
    return cache && cache.search === search ? cache : undefined;
  } catch {
    return undefined;
  }
}

function saveIndexCache(cache: IndexCache) {
  try {
    const json = JSON.stringify(cache);
    if (json.length <= INDEX_CACHE_MAX) sessionStorage.setItem(INDEX_CACHE_KEY, json);
    else sessionStorage.removeItem(INDEX_CACHE_KEY);
  } catch {
    // Storage full or blocked: Back just loads the list again.
  }
}

const newestOf = (items: readonly ReplaySummary[], since?: string) =>
  items.reduce((newest, item) => (newest === undefined || item.capturedAt > newest ? item.capturedAt : newest), since);

/** Rings new items once they're on screen (after any feed transition has placed them). */
function markArrivals(ids: readonly string[]) {
  window.setTimeout(() => {
    for (const id of ids) {
      const item = document.querySelector<HTMLElement>(`.feed-list [data-entry-id="${CSS.escape(id)}"]`);
      if (!item) continue;
      item.dataset.arrived = '';
      window.setTimeout(() => delete item.dataset.arrived, 1600);
    }
  }, 50);
}

function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]) {
  return a.length === b.length && a.every((item, index) => item.id === b[index]!.id);
}

export function ReplayIndex() {
  const [filters, setFilters] = useState<ReplayFilters>(() => filtersFromSearch(location.search));
  const [forMe, setForMe] = useState(() => forMeFromSearch(location.search));
  const [linked, setLinked] = useState(storedLinkedHandles);
  const [me, setMe] = useState<Me>();
  /** The sessions request (and the Back cache's key): the filters, plus For me. */
  const listSearch = withForMe(searchFromFilters(filters), forMe, linked);
  const [restored] = useState(() => restoredIndex(listSearch));
  const [kind, setKind] = useState<IndexKind | undefined>(() => kindFromSearch(location.search));
  const purposes = pagePurposes();
  const [purpose, setPurpose] = useState<string | undefined>(() => purposeFromSearch(location.search, purposes));
  const [query, setQuery] = useState(filters.q ?? '');
  const [items, setItems] = useState<ReplaySummary[] | undefined>(restored?.items);
  const [loadError, setError] = useState('');
  const [settledFilters, setSettledFilters] = useState<ReplayFilters | undefined>(restored ? filters : undefined);
  const [hosts, setHosts] = useState<string[]>(() =>
    [...new Set((restored?.items ?? []).map((summary) => summary.host).filter(Boolean))].sort(),
  );
  // Every tag seen so far, like hosts: choosing one narrows the list, but the other tags stay on offer.
  const [tags, setTags] = useState<string[]>(() => tagOptions(restored?.items ?? []).sort());
  const [sort, setSort] = useState<Sort>(() => sortFromSearch(location.search));
  /** Undefined until the first suites request settles, so suite replays never flash as sessions. */
  const [suites, setSuites] = useState<ReviewSuiteIndexEntry[] | undefined>(restored?.suites);
  // What the feed shows right now (for refreshes) and the newest item this tab has listed (for arrivals).
  const shown = useRef({ items: restored?.items, suites: restored?.suites });
  useLayoutEffect(() => {
    shown.current = { items, suites };
  }, [items, suites]);
  const newest = useRef(restored?.newest);
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

  // Debounce typing into the search box; other filters apply immediately.
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
    fetch(apiUrl('me'), { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Me) : undefined))
      .then((loaded) => {
        if (loaded && typeof loaded === 'object') setMe(loaded);
      })
      .catch(() => {
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

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl(`replays${listSearch}`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Replays failed to load (${response.status})`);
        return (await response.json()) as ReplaySummary[];
      })
      .then((summaries) => {
        if (controller.signal.aborted) return;
        const previous = shown.current.items;
        // Newer than anything this tab listed before (e.g. your upload): it glows once it's in (feed.css).
        const arrived = newest.current ? summaries.filter((summary) => summary.capturedAt > newest.current!) : [];
        newest.current = newestOf(summaries, newest.current);
        const apply = () => {
          setError('');
          setItems(summaries);
          setHosts((known) => [...new Set([...known, ...summaries.map((summary) => summary.host).filter(Boolean)])].sort());
          setTags((known) => [...new Set([...known, ...tagOptions(summaries)])].sort());
        };
        // A changed list (filters, search, a refresh with new items) moves in place; the same list just settles.
        if (previous && !sameIds(previous, summaries)) feedTransition(apply);
        else apply();
        if (arrived.length > 0) markArrivals(arrived.map((summary) => `session:${summary.id}`));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || (reason as Error).name === 'AbortError') return;
        // fetch rejects with a TypeError ("Failed to fetch") when the server cannot be reached at all.
        setError(
          reason instanceof TypeError
            ? `Could not reach ${productName()}. Check your connection.`
            : reason instanceof Error
              ? reason.message
              : String(reason),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledFilters(filters);
      });
    return () => controller.abort();
    // `listSearch` follows `filters` and For me; changing For me or a linked handle also replaces `filters` (changeForMe).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    // Default cache mode so index.html's preload of this exact URL is reused; the server answers
    // `Cache-Control: no-store`, so the list is never stale.
    fetch(apiUrl(withForMe(INDEX_SUITES_URL, forMe, linked)), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Review suites failed to load (${response.status})`);
        return (await response.json()) as ReviewSuiteIndexEntry[];
      })
      .then((loaded) => {
        const previous = shown.current.suites;
        if (previous && !sameIds(previous, loaded)) feedTransition(() => setSuites(loaded));
        else setSuites(loaded);
        const runs = loaded.flatMap((suite) => suite.runDetails);
        setHosts((known) => [...new Set([...known, ...runs.map((run) => run.replay?.host ?? '').filter(Boolean)])].sort());
        setTags((known) => [...new Set([...known, ...tagOptions(runs.flatMap((run) => (run.replay ? [run.replay] : [])))])].sort());
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name === 'AbortError') return;
        console.warn('Review suites unavailable:', reason);
        setSuites([]);
      });
    return () => controller.abort();
  }, [forMe, linked]);

  const unsegmented = useMemo(
    () => (items && suites ? sortEntries(buildIndexEntries(items, suites, settledFilters ?? filters, kind), sort) : undefined),
    // Filter suites with the filters the session list was loaded for, so both kinds update together.
    [items, suites, settledFilters, filters, kind, sort],
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
    if (!restored && !entered.current && shell.current) staggerIn(shell.current);
    entered.current = true;
  }, [listed, restored]);
  // What a card opens is known before its bundle loads: the viewer's skeleton takes its shape (navigation.ts).
  useEffect(() => {
    if (items) rememberListed(items);
    for (const suite of suites ?? []) rememberListed((suite.runDetails ?? []).flatMap((run) => (run.replay ? [run.replay] : [])));
  }, [items, suites]);
  // Remember the list for Back (only once the server has answered for the current filters).
  useEffect(() => {
    if (!items || !suites || settledFilters !== filters || (restored && items === restored.items)) return;
    saveIndexCache({ search: listSearch, items, suites, ...(newest.current ? { newest: newest.current } : {}) });
  }, [items, suites, settledFilters, filters, restored, listSearch]);
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
  const pending = settledFilters !== filters || query !== (filters.q ?? '') || !suites;
  const error = settledFilters === filters ? loadError : '';
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
  const searchField = <CommandSearch value={query} onChange={setQuery} entries={entries} total={entries?.length} compact={compact} />;
  const count = (
    <span className="scope-count" role="status" aria-atomic="true">
      {pending
        ? items
          ? 'Updating replays…'
          : 'Loading replays…'
        : !error && entries
          ? `${replays} ${replays === 1 ? 'replay' : 'replays'}${suiteRows ? ` · ${suiteRows} ${suiteRows === 1 ? 'suite' : 'suites'}` : ''}`
          : ''}
    </span>
  );
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

  return (
    <main className="index-shell" ref={shell}>
      {/* One sticky block: identity + search + actions, then scope (count, filter, sort, layout), then chips. */}
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
        {purposes.length ? <PurposeSegments purposes={purposes} value={purpose} counts={counts} onChange={changePurpose} /> : null}
        <ScopeBar count={count}>
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
        <CompactFilterChips {...filterState} />
      </div>

      <section className="index-body" aria-label="Replays" aria-busy={pending}>
        {/* Plugins' blocks above the list (registerIndexSection), given what the list shows. */}
        {items && !error ? <IndexSections summaries={items} /> : null}
        {error ? (
          <div className="empty" role="alert">
            <strong>{error}</strong>
            <span>Reload the page to try again.</span>
          </div>
        ) : entries && entries.length === 0 ? (
          filtered ? (
            <div className="empty">
              <strong>No replays match these filters</strong>
              <button type="button" className="button secondary" onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : (
            <EmptyIndex onUpload={() => upload.current?.open()} />
          )
        ) : entries ? (
          <MeContext value={meContext}>
            <Feed entries={entries} view={view} grouped={sort.key === 'capturedAt'} query={filters.q?.trim() ?? ''} />
          </MeContext>
        ) : (
          <FeedSkeleton view={view} />
        )}
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

function EmptyIndex({ onUpload }: { onUpload: () => void }) {
  const uploadUrl = `${location.origin}${apiUrl('replays')}`;
  return (
    <div className="empty-index">
      <h2>No replays yet</h2>
      <p>Upload a replay.json or an rrweb export, or drop one anywhere on this page.</p>
      <Button className="empty-upload" onClick={onUpload}>
        Upload a replay…
      </Button>
      <p className="empty-index-or">Or capture and upload from the command line:</p>
      <CommandBlock
        label="Capture an agent run"
        command={`pnpm capture -- --url https://example.com --title "Example" \\\n  --steps @sample/example.steps.json \\\n  --upload-url ${uploadUrl}`}
      />
      <CommandBlock
        label="Import an rrweb recording"
        command={`pnpm run import -- --rrweb events.json --title "Checkout bug" \\\n  --upload-url ${uploadUrl}`}
      />
    </div>
  );
}

/** A shell command that scrolls sideways inside its own box; Copy sits outside the scroll area so it is always reachable. */
function CommandBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState<boolean>();
  useEffect(() => {
    if (copied === undefined) return;
    const timer = window.setTimeout(() => setCopied(undefined), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <figure className="command-block">
      <figcaption>
        <span>{label}</span>
        <button
          type="button"
          className="copy-command"
          aria-label={`Copy command: ${label}`}
          onClick={() => void copyText(command).then(setCopied)}
        >
          {copied === undefined ? 'Copy' : copied ? 'Copied' : 'Copy failed'}
        </button>
      </figcaption>
      {/* Reachable by keyboard so a long line can be scrolled sideways. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <pre tabIndex={0} aria-label={label}>
        <code>{command}</code>
      </pre>
      <span className="visually-hidden" role="status">
        {copied === undefined ? '' : copied ? 'Command copied' : 'Could not copy the command'}
      </span>
    </figure>
  );
}
