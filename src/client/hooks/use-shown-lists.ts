import { useLayoutEffect, useRef, useState } from 'react';

import type { ReplaySummary } from '../../shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../../shared/review-suite.ts';
import { listedNewest, rememberNewest } from '../index/index-cache.ts';
import { feedTransition } from '../index/feed-transition.ts';
import type { IndexLists } from '../data/index-feed.ts';

interface Shown {
  items: ReplaySummary[] | undefined;
  suites: ReviewSuiteIndexEntry[] | undefined;
  /** The view (filters, For me) these lists answer. */
  view: string;
}

/** The same entries, in any order (order is the feed's sort, not the list's). */
function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]) {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((item) => item.id));
  return b.every((item) => ids.has(item.id));
}

/** Both lists are known and hold different entries (a list arriving or leaving is a change of view, not a move). */
const differs = (before: readonly { id: string }[] | undefined, after: readonly { id: string }[] | undefined) =>
  Boolean(before && after && !sameIds(before, after));

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

/**
 * What the feed shows. A change of view (a filter, a keystroke) shows the new lists in the same commit. A change the
 * server brought for the same view (a revalidation with new or removed entries) moves in place (feedTransition), and
 * anything newer than this tab has listed glows once it is in.
 */
export function useShownLists(lists: Pick<IndexLists, 'items' | 'suites'>, view: string) {
  const [shown, setShown] = useState<Shown>(() => ({ items: lists.items, suites: lists.suites, view }));
  const newest = useRef(listedNewest());
  const changed = lists.items !== shown.items || lists.suites !== shown.suites || view !== shown.view;
  const moved =
    changed &&
    view === shown.view &&
    (differs(shown.items, lists.items) || differs(shown.suites, lists.suites));
  // Same entries (or a new view): shown in this render. New or removed entries: shown by the transition below.
  if (changed && !moved) setShown({ items: lists.items, suites: lists.suites, view });
  useLayoutEffect(() => {
    if (moved) feedTransition(() => setShown({ items: lists.items, suites: lists.suites, view }));
  }, [moved, lists.items, lists.suites, view]);
  // Newer than anything this tab listed before (e.g. your upload): it glows once it's in (feed.css).
  useLayoutEffect(() => {
    if (!lists.items) return;
    const since = newest.current;
    const arrived = since ? lists.items.filter((summary) => summary.capturedAt > since) : [];
    newest.current = newestOf(lists.items, since);
    rememberNewest(newest.current);
    if (arrived.length > 0) markArrivals(arrived.map((summary) => `session:${summary.id}`));
  }, [lists.items]);
  return moved ? shown : { items: lists.items, suites: lists.suites, view };
}
