import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Both glyphs stay hidden from assistive technology while their shared button keeps its accessible name. */
export function useIconSwap(state: 'a' | 'b') {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(state);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const host = ref.current;
    const changed = previous.current !== state;
    previous.current = state;
    if (!host || !changed || reduced) return;
    const animations = [...host.querySelectorAll<SVGElement>(':scope > svg')].map((icon) => {
      const incoming = icon.classList.contains(`icon-${state}`);
      return animate(
        [icon],
        {
          opacity: incoming ? [0, 1] : [1, 0],
          transform: incoming ? ['scale(0.25)', 'scale(1)'] : ['scale(1)', 'scale(0.25)'],
          filter: incoming ? ['blur(2px)', 'blur(0px)'] : ['blur(0px)', 'blur(2px)'],
        },
        { duration: 0.16, ease: 'easeOut' },
      );
    });
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [reduced, state]);
  return ref;
}
