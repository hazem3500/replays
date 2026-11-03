import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

/** Keeps the fullscreen action mounted for keyboard access while Motion handles its pointer presence. */
export function useFullscreenPresence() {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    const stage = button?.closest('.stage-wrap');
    if (!button || !stage) return;
    const coarse = matchMedia('(pointer: coarse)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: ReturnType<typeof animate> | undefined;
    let frame = 0;
    let previous: boolean | undefined;
    const update = () => {
      const focused = stage.contains(document.activeElement);
      const shown = coarse.matches || focused || stage.matches(':hover');
      if (shown === previous && !reduced.matches) return;
      animation?.stop();
      button.style.pointerEvents = shown ? 'auto' : 'none';
      if (previous === undefined || reduced.matches || focused) {
        button.style.opacity = shown ? '1' : '0';
        button.style.transform = shown ? 'scale(1)' : 'scale(0.94)';
      } else {
        animation = animate(
          [button],
          { opacity: shown ? 1 : 0, transform: shown ? 'scale(1)' : 'scale(0.94)' },
          {
            duration: 0.16,
            ease: 'easeOut',
          },
        );
      }
      previous = shown;
    };
    const afterFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    stage.addEventListener('pointerenter', update);
    stage.addEventListener('pointerleave', update);
    stage.addEventListener('focusin', update);
    stage.addEventListener('focusout', afterFocus);
    coarse.addEventListener('change', update);
    reduced.addEventListener('change', update);
    return () => {
      animation?.cancel();
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerenter', update);
      stage.removeEventListener('pointerleave', update);
      stage.removeEventListener('focusin', update);
      stage.removeEventListener('focusout', afterFocus);
      coarse.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
    };
  }, []);
  return ref;
}
