import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

export type EntryMotionKind = 'text' | 'number' | 'error' | 'success';

/** Owns transient label, error and success motion without changing their accessible content or layout. */
export function useEntryMotion<T extends HTMLElement>(kind: EntryMotionKind) {
  const ref = useRef<T>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || reduced || typeof element.animate !== 'function') return;
    const motion =
      kind === 'error'
        ? animate(
            [element],
            { transform: ['translateX(0)', 'translateX(6px)', 'translateX(-4px)', 'translateX(2px)', 'translateX(0)'] },
            { duration: 0.24, ease: 'easeOut' },
          )
        : animate(
            [element],
            {
              opacity: [0, 1],
              transform: ['translateY(4px)', 'translateY(0)'],
              filter: [`blur(${kind === 'number' ? 1 : 2}px)`, 'blur(0px)'],
            },
            { duration: kind === 'number' ? 0.16 : 0.15, ease: 'easeOut' },
          );
    const checks =
      kind === 'success'
        ? [...element.querySelectorAll<SVGPathElement>('.success-check path')].map((path) => {
            path.style.setProperty('stroke-dasharray', '24');
            return animate([path], { strokeDashoffset: [24, 0] }, { duration: 0.24, delay: 0.06, ease: 'easeOut' });
          })
        : [];
    return () => {
      motion.cancel();
      for (const check of checks) check.cancel();
    };
  }, [kind, reduced]);
  return ref;
}
