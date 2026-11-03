import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** The filter row remains the switch control; its decorative thumb follows the measured track. */
export function useFilterThumbMotion(checked: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(checked);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const thumb = ref.current;
    const track = thumb?.parentElement;
    const changed = previous.current !== checked;
    previous.current = checked;
    if (!thumb || !track) return;
    const inset = Number.parseFloat(getComputedStyle(thumb).left) || 0;
    const travel = Math.max(0, track.clientWidth - thumb.offsetWidth - inset * 2);
    const target = `translateX(${checked ? travel : 0}px)`;
    if (!changed || reduced || typeof thumb.animate !== 'function') {
      thumb.style.transform = target;
      return;
    }
    const controls = animate([thumb], { transform: [getComputedStyle(thumb).transform, target] }, { duration: 0.16, ease: 'easeOut' });
    return () => controls.stop();
  }, [checked, reduced]);
  return ref;
}
