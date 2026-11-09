import type { AnimatedIconName } from '@/components/animated-icon-data.ts';

import { replayHref, suiteHref } from '../routing/links.ts';

/** One entry of a row's menu: the "⋯" button and the right-click menu both draw their items from these. */
export type RowAction =
  | { id: 'open' | 'open-new-tab' | 'copy-link' | 'compare-runs'; label: string; icon: AnimatedIconName; href: string; disabled?: boolean }
  | { id: 'delete'; label: string; icon: AnimatedIconName; separatorBefore: true };

const open = (href: string): RowAction => ({ id: 'open', label: 'Open', icon: 'play', href });
const openInNewTab = (href: string): RowAction => ({ id: 'open-new-tab', label: 'Open in new tab', icon: 'arrow-up-right', href });
const copyLink = (href: string): RowAction => ({ id: 'copy-link', label: 'Copy link', icon: 'link', href });

/** A recording on its own: open it, share it, or move it to trash. */
export function replayRowActions(id: string): RowAction[] {
  const href = replayHref(id);
  return [open(href), openInNewTab(href), copyLink(href), { id: 'delete', label: 'Delete replay', icon: 'trash-2', separatorBefore: true }];
}

/**
 * A review suite. It is never deleted from the index. `href` is the row's own address (it names the run on a cycling card);
 * "Compare runs" always opens the suite itself, which compares its recordings, and needs at least two of them.
 */
export function suiteRowActions(href: string, suiteId: string, recordings: number): RowAction[] {
  return [
    open(href),
    openInNewTab(href),
    copyLink(href),
    { id: 'compare-runs', label: 'Compare runs', icon: 'columns-2', href: `${suiteHref(suiteId)}?view=compare`, disabled: recordings < 2 },
  ];
}
