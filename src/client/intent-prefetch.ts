import { useEffect } from 'react';

import type { ReviewSuiteIndexRun } from '../shared/review-suite.ts';
import { previewHover } from './index/preview.ts';
import { prefetchReplay, queryClient, suiteQuery } from './queries.ts';
import { apiUrl, parseRoute } from './route.ts';
import { initialRunReplayId } from './suite/runs.ts';

/*
 * Intent prefetch on the index: when a row shows intent (the hover previews' 250 ms pointer intent, a keyboard visit,
 * or a press), warm what its page will need: the replay bundle (or the suite and the run it lands
 * on) and the viewer's code. Pages are separate documents, so data goes through `<link rel=prefetch>`:
 * unlike fetch(), it outlives the navigation it anticipates, at the lowest network priority, and the next
 * page's preload and fetch() read it from the HTTP cache (uploaded bundles are cacheable for a day).
 */

export type IntentTarget = { kind: 'replay'; id: string } | { kind: 'suite'; id: string; landing?: string | undefined };

/** The URLs a target's page loads (index.html's preload list, mirrored). */
export function intentUrls(target: IntentTarget) {
  if (target.kind === 'replay') return [apiUrl(`replays/${encodeURIComponent(target.id)}`)];
  return [
    apiUrl(`suites/${encodeURIComponent(target.id)}?expand=runs`),
    ...(target.landing ? [apiUrl(`replays/${encodeURIComponent(target.landing)}`)] : []),
  ];
}

/** `session:<id>` and `suite:<id>` (Feed.tsx row keys) to a target; `landing` finds a suite's first run. */
export function targetForKey(key: string, landing: (suiteId: string) => string | undefined = () => undefined): IntentTarget | undefined {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (!id) return undefined;
  if (kind === 'session') return { kind: 'replay', id };
  if (kind === 'suite') return { kind: 'suite', id, landing: landing(id) };
  return undefined;
}

/** A link to a replay or suite page as a target; undefined for anything else (the index, other sites). */
export function targetForHref(href: string, landing: (suiteId: string) => string | undefined = () => undefined): IntentTarget | undefined {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return undefined;
  }
  if (url.origin !== location.origin) return undefined;
  const route = parseRoute(url.pathname, url.search);
  if (route.kind === 'replay') return { kind: 'replay', id: route.id };
  if (route.kind === 'suite') return { kind: 'suite', id: route.id, landing: route.replayId ?? landing(route.id) };
  return undefined;
}

/** Metered or very slow connections get no speculative downloads. */
export function prefetchAllowed() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

const requested = new Set<string>();

/** One low-priority `<link rel=prefetch>` per URL per page. */
export function prefetchUrl(url: string, doc: Document = document) {
  if (requested.has(url)) return false;
  requested.add(url);
  const link = doc.createElement('link');
  link.rel = 'prefetch';
  // The same request shape as index.html's preload and the app's fetch(), so the cache entry matches.
  link.as = 'fetch';
  link.crossOrigin = 'anonymous';
  link.fetchPriority = 'low';
  link.href = url;
  doc.head.append(link);
  return true;
}

// The pages' code: same chunks as App.tsx's lazy imports (fetched and cached once; evaluated off the click path).
const loadViewerCode = () => import('./Viewer.tsx').catch(() => undefined);
const loadSuiteCode = () => import('./suite/SuiteWorkspace.tsx').catch(() => undefined);

let clientNavigation = false;

/**
 * Called by the router when index ↔ viewer navigation stays in this document: prefetches then go into the
 * Query cache (parsed, so the next page renders at once) instead of only the HTTP cache. While pages are
 * full loads, parsing a bundle here would be wasted main-thread time, so only the bytes are fetched.
 */
export function setClientNavigation(enabled: boolean) {
  clientNavigation = enabled;
}

export function prefetchTarget(target: IntentTarget | undefined) {
  if (!target || !prefetchAllowed()) return;
  if (clientNavigation) {
    if (target.kind === 'suite') void queryClient.prefetchQuery(suiteQuery(target.id));
    const replayId = target.kind === 'replay' ? target.id : target.landing;
    if (replayId) void prefetchReplay(queryClient, replayId);
  } else for (const url of intentUrls(target)) prefetchUrl(url);
  void loadViewerCode();
  if (target.kind === 'suite') void loadSuiteCode();
}

type Landing = (suiteId: string) => string | undefined;

/** A press on a row's link: at once for a mouse; for touch only once it is a tap, not the start of a scroll. */
function onPress(landing: Landing) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: IntentTarget | undefined;
  const fire = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    prefetchTarget(pending);
    pending = undefined;
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const down = (event: PointerEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    const target = link ? targetForHref(link.href, landing) : undefined;
    if (!target) return;
    pending = target;
    if (event.pointerType === 'mouse') fire();
    // A scroll that starts on the row cancels the pointer (pointercancel) within a few frames.
    else timer = setTimeout(fire, 90);
  };
  const up = () => {
    if (pending) fire();
  };
  addEventListener('pointerdown', down, { capture: true, passive: true });
  addEventListener('pointerup', up, { capture: true, passive: true });
  addEventListener('pointercancel', cancel, { capture: true, passive: true });
  return () => {
    cancel();
    removeEventListener('pointerdown', down, { capture: true });
    removeEventListener('pointerup', up, { capture: true });
    removeEventListener('pointercancel', cancel, { capture: true });
  };
}

/** What the hook reads from the feed's entries (Feed.tsx FeedEntry): each suite's runs. */
type Entry = { kind: string; suite?: { id: string; runDetails?: readonly ReviewSuiteIndexRun[] } };

/**
 * Wires intent prefetch for the feed: the hover previews' intent (preview.ts), presses, and the viewer's
 * code once the index is idle. Suite entries give each suite row the run its page opens on.
 */
export function useIntentPrefetch(entries: readonly Entry[]) {
  useEffect(() => {
    const landings = new Map(
      entries.flatMap(({ suite }) => (suite ? [[suite.id, initialRunReplayId(suite.runDetails ?? [], true)] as const] : [])),
    );
    const landing: Landing = (id) => landings.get(id);
    const stopHover = previewHover.subscribe(() => {
      if (previewHover.active) prefetchTarget(targetForKey(previewHover.active, landing));
    });
    const stopPress = onPress(landing);
    return () => {
      stopHover();
      stopPress();
    };
  }, [entries]);

  // Most index visits end in a replay: fetch the viewer's code when the page has nothing else to do.
  useEffect(() => {
    if (!prefetchAllowed()) return;
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(() => void loadViewerCode(), { timeout: 4000 });
    return () => cancelIdle(handle as number);
  }, []);
}
