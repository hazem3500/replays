import { type RefObject, useLayoutEffect, useState } from 'react';

/** Measures the container so resizable siblings retain usable bounds after layout changes. */
export function useElementWidth(element: RefObject<HTMLElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? fallback));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, fallback]);
  return width;
}
