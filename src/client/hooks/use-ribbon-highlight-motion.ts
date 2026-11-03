import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Moves the hovered diagnostic's bracket without interpolating replay-clock or brush geometry. */
export function useRibbonHighlightMotion(_id: string | undefined, at: number, end: number, span: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ left: string; width: string } | undefined>(undefined);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      previous.current = undefined;
      return;
    }
    const minimum = Number.parseFloat(getComputedStyle(node.parentElement ?? node).getPropertyValue('--ribbon-mark-min')) || 2;
    const parentWidth = node.parentElement?.clientWidth ?? 0;
    const target = {
      left: `${(at / Math.max(1, span)) * parentWidth}px`,
      width: `${Math.max(minimum, ((end - at) / Math.max(1, span)) * parentWidth)}px`,
    };
    const before = previous.current;
    previous.current = target;
    if (!before || reduced || typeof node.animate !== 'function') return;
    const controls = animate(
      [node],
      { left: [before.left, target.left], width: [before.width, target.width] },
      { duration: 0.18, ease: 'easeOut' },
    );
    let live = true;
    void controls.then(() => {
      if (!live) return;
      node.style.left = `${(at / Math.max(1, span)) * 100}%`;
      node.style.width = `max(var(--ribbon-mark-min), ${((end - at) / Math.max(1, span)) * 100}%)`;
    });
    return () => {
      live = false;
      const current = getComputedStyle(node);
      previous.current = { left: current.left, width: current.width };
      controls.cancel();
    };
  }, [at, end, span, reduced]);
  return ref;
}
