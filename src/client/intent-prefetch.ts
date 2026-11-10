import { useEffect } from 'react';

import type { ReviewSuiteIndexRun } from '../shared/review-suite.ts';
import { previewHover } from './index/preview.ts';
import { prefetchAllowed } from './prefetch-allowed.ts';
import { prefetchReplay, queryClient, suiteQuery } from './queries.ts';
import { clientRouter } from './routing/client.ts';
import { isAppPage } from './routing/links.ts';
import { pageOfPublicPath } from './routing/page-key.ts';
import { suiteComparePage, suitePage, viewerPage, warm } from './routing/pages.ts';
import { initialRunReplayId } from './suite/runs.ts';

/*
 * Intent prefetch on the index: when a row shows intent (the hover previews' 250 ms pointer intent, a keyboard visit,
 * or a press), warm what its page will need: the replay bundle (or the suite and the run it lands on) into the Query
 * cache, parsed, so the page renders at once, and the page's code.
 */

export type IntentTarget = { kind: 'replay'; id: string } | { kind: 'suite'; id: string; landing?: string | undefined };

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
  if (url.origin !== location.origin || !isAppPage(url.pathname)) return undefined;
  const router = clientRouter();
  const page = pageOfPublicPath(router, url.pathname, router.options.context.deployment.base);
  if (page.kind === 'replay' && page.replayId) return { kind: 'replay', id: page.replayId };
  if (page.kind === 'suite' && page.suiteId) return { kind: 'suite', id: page.suiteId, landing: page.replayId ?? landing(page.suiteId) };
  return undefined;
}

export function prefetchTarget(target: IntentTarget | undefined) {
  if (!target || !prefetchAllowed()) return;
  if (target.kind === 'suite') void queryClient.prefetchQuery(suiteQuery(target.id));
  const replayId = target.kind === 'replay' ? target.id : target.landing;
  if (replayId) void prefetchReplay(queryClient, replayId);
  warm(viewerPage);
  if (target.kind === 'suite') {
    warm(suitePage);
    warm(suiteComparePage);
  }
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
 * Warms replay data and code on the feed's hover or press intent. Suite entries identify the first run.
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
}
