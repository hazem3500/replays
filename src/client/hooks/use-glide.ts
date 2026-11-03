import { animate } from 'motion/mini';
import { type RefObject, useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

/** Motion glides keyed horizontal changes with an independent translate, preserving each item's enter/exit transform. */
export function useGlide(container: RefObject<HTMLElement | null>, selector: string, attribute: string) {
  const positions = useRef(new Map<string, number>());
  const animations = useRef(new Map<HTMLElement, ReturnType<typeof animate>>());
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) {
      positions.current.clear();
      return;
    }
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
    const next = new Map<string, number>();
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const id = element.getAttribute(attribute);
      if (!id) continue;
      const left = element.getBoundingClientRect().left;
      next.set(id, left);
      const before = positions.current.get(id);
      if (reduced || before === undefined || Math.abs(before - left) < 0.5) continue;
      animations.current.set(
        element,
        animate([element], { translate: [`${before - left}px 0px`, '0px 0px'] }, { duration: 0.2, ease: [0.23, 1, 0.32, 1] }),
      );
    }
    positions.current = next;
  });
  useLayoutEffect(() => {
    const running = animations.current;
    return () => {
      for (const animation of running.values()) animation.cancel();
      running.clear();
    };
  }, []);
}
