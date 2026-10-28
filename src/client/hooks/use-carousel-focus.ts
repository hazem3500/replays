import { type RefObject, useLayoutEffect } from 'react';

/**
 * Phones swipe through tiles; a focus chosen elsewhere (the run menu, J) brings its tile into view at once, so the
 * swipe position and the focus never disagree.
 */
export function useCarouselFocus(area: RefObject<HTMLElement | null>, active: boolean, index: number) {
  useLayoutEffect(() => {
    const element = area.current;
    if (!active || !element) return;
    const left = index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollTo({ left, behavior: 'instant' });
  }, [active, area, index]);
}
