import { type RefObject, useLayoutEffect } from 'react';

/**
 * Brings row `index` of a fixed-height list into view when it changes (a selection made elsewhere: the error jump, a
 * link from Performance), placing it a third of the way down. Rows already in view stay put.
 */
export function useRevealRow(scroller: RefObject<HTMLElement | null>, index: number, rowHeight: number, headerHeight: number) {
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || index < 0) return;
    const top = headerHeight + index * rowHeight;
    const inView = top >= element.scrollTop + headerHeight && top + rowHeight <= element.scrollTop + element.clientHeight;
    if (inView) return;
    element.scrollTop = Math.max(0, top - Math.round(element.clientHeight / 3));
    // oxlint-disable-next-line react/exhaustive-deps -- why: only a new selection moves the list, never a resize.
  }, [index]);
}
