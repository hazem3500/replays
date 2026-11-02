import { type RefObject, useLayoutEffect, useState } from 'react';

/** The element's content-box width, kept current as it resizes (0 until mounted). */
export function useElementWidth(element: RefObject<HTMLElement | null>, fallback = 0) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => setWidth(Math.round(node.clientWidth) || fallback);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element, fallback]);
  return width;
}
