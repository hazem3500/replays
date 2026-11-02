import { type RefObject, useLayoutEffect } from 'react';

/**
 * Publishes the sticky block's rendered height as `variable` on `host`, so what sticks under it (the index's day
 * headings) starts exactly at its bottom edge. The height is the unrounded border box, so text scaling, the top
 * safe-area inset (it moves with a phone browser's toolbars) and any device pixel ratio leave no gap or overlap.
 */
export function useStickyStack(host: RefObject<HTMLElement | null>, block: RefObject<HTMLElement | null>, variable: string) {
  useLayoutEffect(() => {
    const target = host.current;
    const stack = block.current;
    if (!target || !stack) return;
    const publish = (height: number) => target.style.setProperty(variable, `${height}px`);
    publish(stack.getBoundingClientRect().height);
    // why: the border box re-measures on padding and border changes too, which a content-box observer never reports.
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0];
      publish(size ? size.blockSize : stack.getBoundingClientRect().height);
    });
    observer.observe(stack, { box: 'border-box' });
    return () => observer.disconnect();
  }, [host, block, variable]);
}
