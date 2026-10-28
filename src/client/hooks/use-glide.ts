import { type RefObject, useLayoutEffect, useRef } from 'react';

const GLIDE = { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' } as const;

/**
 * FLIP for a row of items: after every render, children of `container` matching `selector` that moved
 * horizontally glide from their old place (transform only, additive so it composes with enter/exit transitions).
 * Items are keyed by `attribute`. Reduced motion: they jump.
 */
export function useGlide(container: RefObject<HTMLElement | null>, selector: string, attribute: string) {
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) {
      positions.current = new Map();
      return;
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const id = element.getAttribute(attribute);
      if (!id) continue;
      const left = element.getBoundingClientRect().left;
      next.set(id, left);
      const before = positions.current.get(id);
      if (reduce || before === undefined || Math.abs(before - left) < 0.5) continue;
      element.animate([{ transform: `translateX(${before - left}px)` }, { transform: 'translateX(0)' }], { ...GLIDE, composite: 'add' });
    }
    positions.current = next;
  });
}
