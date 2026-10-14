import { type RefObject, useLayoutEffect, useState } from 'react';

export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  count: number;
  rowHeight: number;
  /** One row may carry extra height below it (an expanded request). */
  extraIndex?: number;
  extraHeight?: number;
  overscan?: number;
}

export interface WindowRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/** Fixed-height rows plus one optional expanded row: offsets have a closed form, no measuring pass. */
export function windowRange({
  scrollTop,
  viewportHeight,
  count,
  rowHeight,
  extraIndex = -1,
  extraHeight = 0,
  overscan = 8,
}: WindowInput): WindowRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const extra = extraIndex >= 0 && extraIndex < count ? extraHeight : 0;
  const offset = (index: number) => index * rowHeight + (extra && index > extraIndex ? extra : 0);
  const indexAt = (y: number) => {
    let index = Math.floor(Math.max(0, y) / rowHeight);
    if (extra && index > extraIndex) {
      const shifted = Math.floor((y - extra) / rowHeight);
      index = shifted <= extraIndex ? extraIndex : shifted;
    }
    return Math.min(count, Math.max(0, index));
  };
  const start = Math.max(0, indexAt(scrollTop) - overscan);
  const end = Math.min(count, indexAt(scrollTop + viewportHeight) + 1 + overscan);
  return { start, end, padTop: offset(start), padBottom: offset(count) - offset(end) };
}

/**
 * Tracks which rows of a scrolling container are visible. `headerHeight`
 * accounts for a sticky table header above the first row.
 */
export function useWindowedRows(
  container: RefObject<HTMLElement | null>,
  {
    count,
    rowHeight,
    headerHeight = 0,
    extraIndex = -1,
    extraHeight = 0,
  }: { count: number; rowHeight: number; headerHeight?: number; extraIndex?: number; extraHeight?: number },
) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewport((current) =>
        current.scrollTop === element.scrollTop && current.height === element.clientHeight
          ? current
          : { scrollTop: element.scrollTop, height: element.clientHeight },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    element.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [container]);

  return windowRange({
    scrollTop: viewport.scrollTop - headerHeight,
    viewportHeight: viewport.height,
    count,
    rowHeight,
    extraIndex,
    extraHeight,
  });
}
