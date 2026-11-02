import { type RefObject, useLayoutEffect, useState } from 'react';

/** The rendered height of a data row matching `selector` (fallback until mounted), re-measured as the body resizes. */
export function useRowHeight(body: RefObject<HTMLElement | null>, selector: string, mounted: boolean, fallback = 31) {
  const [height, setHeight] = useState(fallback);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    let watched: HTMLElement | null = null;
    const observer = new ResizeObserver(() => {
      const row = element.querySelector<HTMLElement>(selector);
      // why: a font swap changes the row's height without resizing the body much, so the row itself is watched too.
      if (row && row !== watched) {
        watched = row;
        observer.observe(row);
      }
      const measured = row?.getBoundingClientRect().height ?? 0;
      // why: any real change counts: twelve rows at 31.6 vs 32 px already put the now divider 5 px off at the end.
      if (measured > 0) setHeight((current) => (Math.abs(measured - current) > 0.05 ? measured : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- why: `mounted` re-runs the effect when the table body first appears.
  }, [body, selector, mounted]);
  return height;
}
