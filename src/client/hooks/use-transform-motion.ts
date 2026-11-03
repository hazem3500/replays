import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Interpolates a decorative transform while its control keeps its own semantic and focus state. */
export function useTransformMotion<E extends HTMLElement | SVGElement = HTMLSpanElement>(transform: string) {
  const ref = useRef<E>(null);
  const visited = useRef(false);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const initial = !visited.current;
    visited.current = true;
    if (initial || reduced || typeof node.animate !== 'function') {
      node.style.setProperty('transform', transform);
      return;
    }
    const controls = animate(
      [node],
      { transform: [getComputedStyle(node).transform, transform] },
      {
        duration: 0.18,
        ease: [0.23, 1, 0.32, 1],
      },
    );
    return () => controls.stop();
  }, [transform, reduced]);
  return ref;
}
