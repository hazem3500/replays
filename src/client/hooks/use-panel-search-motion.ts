import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/mini';

/** Expands a newly opened search field from its right-hand trigger; `enabled` false shows it in place. */
export function usePanelSearchMotion(enabled = true) {
  const ref = useRef<HTMLLabelElement>(null);
  useLayoutEffect(() => {
    const target = ref.current;
    if (!enabled || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const motion = animate(
      target,
      { clipPath: ['inset(0 0 0 calc(100% - 28px))', 'inset(0 0 0 0)'], opacity: [0.5, 1] },
      { duration: 0.16 },
    );
    return () => motion.cancel();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- why: the motion plays once, when the field first appears.
  }, []);
  return ref;
}
