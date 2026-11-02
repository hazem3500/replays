import { type RefObject, useLayoutEffect, useRef } from 'react';

/** The longest a glide may take before the stage counts as settled even without a `scrollend`. */
const GLIDE_MS = 700;

/**
 * Phones swipe through tiles; a focus chosen elsewhere (the switch above the stage, the run menu, J) glides its tile
 * into view, and the first placement is instant. While a glide runs the stage carries `data-gliding`, so its scroll
 * events move the switch's thumb without being read as a swipe to another recording.
 */
export function useCarouselFocus(area: RefObject<HTMLElement | null>, active: boolean, index: number) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const element = area.current;
    if (!active || !element) {
      placed.current = false;
      return;
    }
    const left = index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) <= 1) {
      placed.current = true;
      return;
    }
    const still = !placed.current || matchMedia('(prefers-reduced-motion: reduce)').matches;
    placed.current = true;
    if (still) {
      element.scrollTo({ left, behavior: 'instant' });
      return;
    }
    element.setAttribute('data-gliding', '');
    const settle = () => {
      element.removeAttribute('data-gliding');
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(settle, GLIDE_MS);
    element.addEventListener('scrollend', settle, { once: true });
    element.scrollTo({ left, behavior: 'smooth' });
    return () => {
      element.removeEventListener('scrollend', settle);
      settle();
    };
  }, [active, area, index]);
}
