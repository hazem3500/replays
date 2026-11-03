import { animate } from 'motion/mini';
import { type RefObject, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** A visible list arrives in reading order without observing or cloning any of its children. */
export function useListArrival(container: RefObject<HTMLElement | null>, selector: string, open: boolean, key: string) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const previous = useRef<{ key: string; elements: Set<HTMLElement> } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      previous.current = null;
      return;
    }
    const elements = [...(container.current?.querySelectorAll<HTMLElement>(selector) ?? [])];
    const arriving = previous.current?.key === key ? [] : elements.filter((element) => !previous.current?.elements.has(element));
    previous.current = { key, elements: new Set(elements) };
    if (reduced) return;
    const animations = arriving
      .filter((element) => typeof element.animate === 'function')
      .map((element, index) =>
        animate(
          [element],
          { opacity: [0, 1], transform: ['translateY(4px)', 'translateY(0px)'] },
          {
            duration: 0.18,
            delay: Math.min(index, 6) * 0.02,
            ease: 'easeOut',
          },
        ),
      );
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [container, key, open, reduced, selector]);
}
