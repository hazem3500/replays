import { animate } from 'motion/mini';
import { useEffectEvent, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Filter token presence and focus handoff remain independent from the Motion exit clock. */
export function useFilterTokenMotion(id: string, exiting: boolean, onExited: (id: string) => void) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const finish = useEffectEvent((completedId: string) => onExited(completedId));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reduced || typeof element.animate !== 'function') {
      if (exiting) finish(id);
      return;
    }
    let active = true;
    const controls = animate(
      [element],
      {
        opacity: exiting ? [1, 0] : [0, 1],
        transform: exiting ? ['scale(1)', 'scale(0.94)'] : ['scale(0.94)', 'scale(1)'],
      },
      { duration: exiting ? 0.12 : 0.18, ease: 'easeOut' },
    );
    if (exiting)
      void controls.then(() => {
        if (active) finish(id);
      });
    return () => {
      active = false;
      controls.cancel();
    };
  }, [exiting, id, reduced]);
  return ref;
}
