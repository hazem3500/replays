import { type RefObject, useLayoutEffect } from 'react';

/**
 * Rows a glide may cover; further, the row is jumped to. invariant: under windowing.ts's overscan (8), so the target is
 * already rendered when focus moves to it, and a long glide would stream every row in between anyway.
 */
const GLIDE_ROWS = 6;

/**
 * Brings row `index` of a fixed-height list into view when it changes, and only when it is out of view. A nearby row
 * (stepping with the arrows) is scrolled smoothly by just enough to show it; a far one (the error jump, a link from
 * Performance, Home or End) is placed a third of the way down at once. Rows already in view stay put.
 */
export function useRevealRow(scroller: RefObject<HTMLElement | null>, index: number, rowHeight: number, headerHeight: number) {
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || index < 0) return;
    const top = headerHeight + index * rowHeight;
    const above = top < element.scrollTop + headerHeight;
    const below = top + rowHeight > element.scrollTop + element.clientHeight;
    if (!above && !below) return;
    const nearest = above ? top - headerHeight : top + rowHeight - element.clientHeight;
    if (Math.abs(nearest - element.scrollTop) > rowHeight * GLIDE_ROWS) {
      element.scrollTop = Math.max(0, top - Math.round(element.clientHeight / 3));
      return;
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ top: Math.max(0, nearest), behavior: still ? 'instant' : 'smooth' });
    // oxlint-disable-next-line react/exhaustive-deps -- why: only a new selection moves the list, never a resize.
  }, [index]);
}
