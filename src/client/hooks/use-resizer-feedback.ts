import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { useMediaQuery } from '../media.ts';

function feedbackScale(active: boolean, orientation: 'horizontal' | 'vertical') {
  if (!active) return '1 1';
  return orientation === 'horizontal' ? '1 2' : '2 1';
}

function feedbackDelay(active: boolean, hovering: boolean, held: boolean, focused: boolean) {
  return active && hovering && !held && !focused ? 0.12 : 0;
}

/** Motion owns resizer affordance feedback; drag geometry and keyboard resizing stay direct. */
export function useResizerFeedback(orientation: 'horizontal' | 'vertical') {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(() => {
    const root = ref.current;
    const line = root?.querySelector<HTMLElement>('[data-resizer-line]');
    const grip = root?.querySelector<HTMLElement>('[data-resizer-grip]');
    if (!root || !line || !grip) return;
    let hovering = false;
    let held = false;
    let running: Array<ReturnType<typeof animate>> = [];
    const update = () => {
      const focused = root.matches(':focus-visible');
      const active = held || root.dataset.dragging !== undefined || focused || hovering;
      const delay = feedbackDelay(active, hovering, held, focused);
      const colour = active ? 'var(--splitter-active, var(--accent))' : 'var(--splitter-line, var(--line))';
      const scale = feedbackScale(active, orientation);
      for (const motion of running) motion.cancel();
      if (reduced) {
        Object.assign(line.style, { backgroundColor: colour, scale });
        Object.assign(grip.style, { opacity: active ? '1' : '0', scale: active ? '1' : '0.6' });
        return;
      }
      const transition = { duration: 0.15, delay, ease: 'easeOut' } as const;
      running = [
        animate([line], { backgroundColor: colour, scale }, transition),
        animate([grip], { opacity: active ? 1 : 0, scale: active ? 1 : 0.6 }, transition),
      ];
    };
    const enter = (event: PointerEvent) => {
      hovering = event.pointerType === 'mouse';
      update();
    };
    const leave = () => {
      hovering = false;
      update();
    };
    const down = (event: PointerEvent) => {
      if (event.button === 0) {
        held = true;
        update();
      }
    };
    const up = () => {
      held = false;
      update();
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('pointerdown', down);
    root.addEventListener('focus', update);
    root.addEventListener('blur', update);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    update();
    return () => {
      for (const motion of running) motion.cancel();
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('focus', update);
      root.removeEventListener('blur', update);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [orientation, reduced]);
  return ref;
}
