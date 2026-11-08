import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/mini';

/** Expands a newly opened search field from its right-hand trigger. */
export function usePanelSearchMotion() {
  const ref = useRef<HTMLLabelElement>(null);
  useLayoutEffect(() => {
    const target = ref.current;
    if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const motion = animate(
      target,
      { clipPath: ['inset(0 0 0 calc(100% - 28px))', 'inset(0 0 0 0)'], opacity: [0.5, 1] },
      { duration: 0.16 },
    );
    return () => motion.cancel();
  }, []);
  return ref;
}
