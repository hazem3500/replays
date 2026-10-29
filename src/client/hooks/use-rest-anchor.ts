import { type RefObject, useLayoutEffect } from 'react';

/**
 * While `active`, publishes where `slot` sits inside its closest `frame` ancestor as `--rest-x` and `--rest-y` (px,
 * on the slot), so an absolutely positioned child can rest exactly over the slot and transition away from it and
 * back. Resizes of the frame, the slot or the slot's row re-measure, so an interrupted transition always returns to
 * the current resting place.
 */
export function useRestAnchor(slot: RefObject<HTMLElement | null>, frame: string, active: boolean) {
  useLayoutEffect(() => {
    const element = slot.current;
    const container = element?.closest<HTMLElement>(frame);
    if (!active || !element || !container) return;
    const measure = () => {
      const anchor = element.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      element.style.setProperty('--rest-x', `${anchor.left - bounds.left}px`);
      element.style.setProperty('--rest-y', `${anchor.top - bounds.top}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const target of [container, element, element.parentElement]) if (target) observer.observe(target);
    return () => {
      observer.disconnect();
      element.style.removeProperty('--rest-x');
      element.style.removeProperty('--rest-y');
    };
  }, [slot, frame, active]);
}
