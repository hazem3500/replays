import { type ReactNode, useId, useRef } from 'react';

import { useFeedVirtualizer } from '../hooks/use-feed-virtualizer.ts';
import { useGridColumns } from '../hooks/use-grid-columns.ts';
import { useScrollReveal } from '../hooks/use-scroll-reveal.ts';
import type { FeedEntry, FeedView } from './Feed.tsx';
import { entryKey, type FeedGroup, type FeedRow, feedLayout, groupSegments } from './feed-layout.ts';
import { EASE, ENTER_KEYFRAMES, ENTER_MS, reducedMotion, staggerDelay } from './list-motion.ts';

/**
 * An item's place in the virtual feed: its row (`data-row`, which keeps a focused row rendered), whether that row is
 * its group's last (`data-last`), and whether this item measures the row (a row's first item: `data-index`, with
 * the measuring ref passed beside the place).
 */
export interface FeedRowPlace {
  index: number;
  last: boolean;
  measured: boolean;
}

type RowRef = ((element: HTMLElement | null) => void) | undefined;
type RenderEntry = (entry: FeedEntry, place: FeedRowPlace, rowRef: RowRef) => ReactNode;
type Virtual = ReturnType<typeof useFeedVirtualizer>;

/** Shorter feeds render every item: the motion system, skeleton hand-over and Back restore see the whole list. */
const VIRTUALIZE_AFTER = 60;
/** Size guesses until a row is measured (heading + list padding, list row, grid card + row gap). */
const ESTIMATE = { head: 56, list: 86, grid: 360 } as const;
/** About one viewport of rows past each edge. */
const OVERSCAN = { list: 10, grid: 3 } as const;

/** Items scrolled into view rise in like arriving ones (list-motion.ts), those arriving together one after another. */
function revealItems(items: HTMLElement[]) {
  if (reducedMotion()) return;
  for (const [index, item] of items.entries())
    item.animate(ENTER_KEYFRAMES, { duration: ENTER_MS, delay: staggerDelay(index), easing: EASE, fill: 'backwards' });
}

/** A group's list: its rendered rows, with spacers standing in for the rows outside the window. */
function GroupList({
  group,
  rows,
  view,
  virtual,
  renderEntry,
}: {
  group: FeedGroup;
  rows: readonly FeedRow[];
  view: FeedView;
  virtual: Virtual;
  renderEntry: RenderEntry;
}) {
  const segments = groupSegments(group.rows, virtual.rendered, virtual.sizes, virtual.spacing(group.key));
  return (
    // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- why: Safari drops list semantics from unstyled lists.
    <ul className="feed-list" data-view={view} data-group={group.key} data-has-suites={group.suites || undefined} role="list">
      {segments.flatMap((segment): ReactNode[] => {
        if (segment.kind === 'spacer')
          return [<li key={segment.key} className="feed-spacer" aria-hidden="true" inert style={{ height: segment.height }} />];
        const row = rows[segment.index];
        if (row?.kind !== 'row') return [];
        return row.entries.map((entry, column) =>
          renderEntry(entry, { index: segment.index, last: row.last, measured: column === 0 }, column === 0 ? virtual.measure : undefined),
        );
      })}
    </ul>
  );
}

/**
 * The feed's layout and window virtualization: day groups with sticky headings (in flow, so they stick as before)
 * when grouped, else one list; past VIRTUALIZE_AFTER entries only the rows near the viewport render. Grid rows hold
 * as many cards as the grid has columns. `renderEntry` draws one item and spreads its place onto the item's `li`.
 */
export function FeedList({
  entries,
  view,
  grouped,
  renderEntry,
}: {
  entries: readonly FeedEntry[];
  view: FeedView;
  grouped: boolean;
  renderEntry: RenderEntry;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const columns = useGridColumns(root, view === 'grid');
  const { rows, groups } = feedLayout(entries, { grouped, columns });
  const specs = rows.map((row) => ({
    key: row.key,
    estimate: row.kind === 'head' ? ESTIMATE.head : ESTIMATE[view],
    pinned: row.kind === 'head',
  }));
  const virtual = useFeedVirtualizer(root, specs, { enabled: entries.length > VIRTUALIZE_AFTER, overscan: OVERSCAN[view] });
  useScrollReveal(root, '[data-entry-id]', `${view}|${entries.map(entryKey).join(',')}`, revealItems);
  return (
    <div ref={root} className={grouped ? 'feed-groups' : 'feed-flat'}>
      {groups.map((group, index) => {
        const list = <GroupList key={group.key} group={group} rows={rows} view={view} virtual={virtual} renderEntry={renderEntry} />;
        if (group.head === undefined) return list;
        return (
          <section key={group.key} className="feed-group" aria-labelledby={`${id}-${index}`}>
            <h2 ref={virtual.measure} data-index={group.head} data-measure="head" className="feed-day" id={`${id}-${index}`}>
              {group.label}
            </h2>
            {list}
          </section>
        );
      })}
    </div>
  );
}
