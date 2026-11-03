import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Wall-clock notices; recorded timing and playback state remain owned by the player. */
export function usePlaybackNoticeMotion(kind: 'speed' | 'skip', visible = true) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof element.animate !== 'function') {
      element.style.opacity = kind === 'speed' || !visible ? '0' : '1';
      return;
    }
    const animation =
      kind === 'speed'
        ? animate(
            [element],
            {
              opacity: [0, 1, 1, 0],
              transform: reduced ? 'none' : ['scale(0.94)', 'scale(1)', 'scale(1)', 'scale(1)'],
            },
            { duration: 0.92, times: [0, 0.13, 0.78, 1], ease: [0.23, 1, 0.32, 1] },
          )
        : animate([element], { opacity: visible ? 1 : 0 }, { duration: reduced ? 0 : 0.16, ease: 'easeOut' });
    return () => animation.stop();
  }, [kind, visible, reduced]);
  return ref;
}
