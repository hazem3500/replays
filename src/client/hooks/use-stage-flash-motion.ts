import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** A stage click acknowledgement uses wall time independently of recorded playback. */
export function useStageFlashMotion() {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== 'function') return;
    const animation = animate(
      [element],
      {
        opacity: [0.9, 0],
        transform: reduced ? 'none' : ['scale(0.85)', 'scale(1.25)'],
      },
      { duration: 0.35, ease: [0.23, 1, 0.32, 1] },
    );
    return () => animation.stop();
  }, [reduced]);
  return ref;
}
