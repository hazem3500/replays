import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Background refreshes wait before showing activity, without changing list data or status announcements. */
export function useRefreshLineMotion(active: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = ref.current;
    const bar = element?.querySelector('span');
    if (!element || !bar) return;
    if (reduced || typeof element.animate !== 'function') {
      element.style.opacity = active ? '1' : '0';
      bar.style.transform = 'none';
      return;
    }
    const rawDelay = getComputedStyle(element).getPropertyValue('--load-line-delay').trim();
    const delay = rawDelay ? Number.parseFloat(rawDelay) / (rawDelay.endsWith('ms') ? 1000 : 1) : 0.3;
    const opacity = animate(
      [element],
      { opacity: active ? [0, 1] : 0 },
      {
        duration: active ? 0.2 : 0.15,
        delay: active ? delay : 0,
        ease: [0.23, 1, 0.32, 1],
      },
    );
    const glide = active
      ? animate(
          [bar],
          { transform: ['translateX(-100%)', 'translateX(360%)'] },
          {
            duration: 1.4,
            repeat: Infinity,
            ease: [0.45, 0, 0.55, 1],
          },
        )
      : undefined;
    return () => {
      opacity.stop();
      glide?.stop();
    };
  }, [active, reduced]);
  return ref;
}
