import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

export function useChevronMotion(open: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(open);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const node = ref.current;
    const changed = previous.current !== open;
    previous.current = open;
    if (!node) return;
    const target = `rotate(${open ? 180 : 0}deg)`;
    if (!changed || reduced || typeof node.animate !== 'function') {
      node.style.transform = target;
      return;
    }
    const controls = animate([node], { transform: [getComputedStyle(node).transform, target] }, { duration: 0.2, ease: 'easeOut' });
    return () => controls.stop();
  }, [open, reduced]);
  return ref;
}
