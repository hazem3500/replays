import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Delays only loading bars, retaining the panel's headers and geometry from its first frame. */
export function usePanelPendingMotion() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const bars = [...(ref.current?.querySelectorAll<HTMLElement>('.skeleton') ?? [])];
    if (!bars.length) return;
    if (reduced || typeof bars[0]?.animate !== 'function') {
      for (const bar of bars) bar.style.opacity = '1';
      return;
    }
    let live = true;
    let pulse: { stop(): void } | undefined;
    const enter = animate(bars, { opacity: [0, 1] }, { duration: 0.18, delay: 0.15, ease: 'easeOut' });
    void enter.then(() => {
      if (!live) return;
      pulse = animate(bars, { opacity: [1, 0.55] }, { duration: 1.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' });
    });
    return () => {
      live = false;
      enter.stop();
      pulse?.stop();
    };
  }, [reduced]);
  return ref;
}
