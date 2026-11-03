import { animate } from 'motion/mini';
import { useLayoutEffect, type RefObject } from 'react';

/** Disabled state remains semantic HTML while its visual dimming follows the shared Motion timeline. */
export function useOpacityMotion(ref: RefObject<HTMLElement | null>, opacity: number, delay = 0) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof node.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.setProperty('opacity', String(opacity));
      return;
    }
    const controls = animate([node], { opacity }, { duration: 0.16, delay, ease: [0.23, 1, 0.32, 1] });
    return () => controls.stop();
  }, [ref, opacity, delay]);
}
