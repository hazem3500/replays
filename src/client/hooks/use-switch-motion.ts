import { animate } from 'motion/mini';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

import { haltMotion } from '../lib/halt-motion.ts';

/** The switch's checked state stays in Base UI; only the thumb's visual transform is animated. */
export function useSwitchMotion(forwardedRef: Ref<HTMLSpanElement> | undefined, checked: boolean) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(checked);
  useImperativeHandle(forwardedRef, () => {
    if (!element.current) throw new Error('Switch ref was read before mounting');
    return element.current;
  }, []);
  useLayoutEffect(() => {
    const node = element.current;
    const changed = previous.current !== checked;
    previous.current = checked;
    if (!node) return;
    const transform = checked ? 'translateX(12px)' : 'translateX(0px)';
    if (!changed || typeof node.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.setProperty('transform', transform);
      return;
    }
    const controls = animate([node], { transform: [getComputedStyle(node).transform, transform] }, { duration: 0.16, ease: 'easeOut' });
    return () => haltMotion(node, controls);
  }, [checked]);
  return element;
}
