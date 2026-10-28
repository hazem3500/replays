import { type RefObject, useEffect, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/** The element's content box, kept current as it resizes; zero until it is measured. */
export function useElementSize(element: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () =>
      setSize((current) =>
        current.width === node.clientWidth && current.height === node.clientHeight
          ? current
          : { width: node.clientWidth, height: node.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return size;
}
