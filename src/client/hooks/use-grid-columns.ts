import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * How many columns the feed's grid lays out (`repeat(auto-fill, …)` in feed.css), read from the first grid list's
 * resolved tracks under `root`, so the count always follows the stylesheet and its breakpoints. 1 while `enabled`
 * is false (the list view).
 */
export function useGridColumns(root: RefObject<HTMLElement | null>, enabled: boolean) {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const node = root.current;
    if (!enabled || !node) return;
    const read = () => {
      const grid = node.querySelector('.feed-list[data-view="grid"]');
      if (!grid) return;
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      setColumns(Math.max(1, tracks));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [root, enabled]);
  return enabled ? columns : 1;
}
