import { type RefObject, useLayoutEffect, useState } from 'react';

/** True while the element is narrower than `width`; re-renders only when it crosses the threshold. */
export function useNarrowerThan(element: RefObject<HTMLElement | null>, width: number) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? width) < width));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, width]);
  return narrow;
}
