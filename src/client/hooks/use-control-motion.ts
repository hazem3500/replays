import { spring } from 'motion';
import { animate } from 'motion/mini';
import { useEffect } from 'react';
import { settleLayers } from '../lib/layer-motion.ts';
import { settleThemeTransition } from '../lib/theme-transition.ts';

const TARGETS =
  '.press-settle, .icon-button, .switch-button, .segmented button, .theme-switch, .button, .source-chip, .index-filters-button, .index-chip, .copy-command, .phone-menu-trigger, .comment-send';

/** Delegated press motion keeps ordinary color hovers in CSS and avoids a React update for pointer movement. */
export function useControlMotion() {
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const running = new Map<HTMLElement, ReturnType<typeof animate>>();
    const pressed = new Set<HTMLElement>();
    const move = (element: HTMLElement, down: boolean) => {
      running.get(element)?.stop();
      if (reduced.matches || typeof element.animate !== 'function') {
        settleLayers();
        settleThemeTransition();
        element.style.setProperty('scale', '1');
        return;
      }
      const animation = animate(
        [element],
        { scale: down ? '0.97' : '1' },
        down ? { duration: 0.1, ease: 'easeOut' } : { type: spring, duration: 0.16, bounce: 0.15 },
      );
      running.set(element, animation);
      void animation.then(() => {
        if (running.get(element) === animation) running.delete(element);
      });
    };
    const release = () => {
      for (const element of pressed) move(element, false);
      pressed.clear();
      if (reduced.matches) {
        for (const [element, animation] of running) {
          animation.cancel();
          element.style.setProperty('scale', '1');
        }
        running.clear();
      }
    };
    const press = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return;
      if (event instanceof PointerEvent && event.button !== 0) return;
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>(TARGETS) : null;
      if (!element || element.closest('.editor-shell') || element.matches(':disabled, [aria-disabled="true"], [aria-haspopup]')) return;
      pressed.add(element);
      move(element, true);
    };
    const releaseKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') release();
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('keydown', press);
    document.addEventListener('keyup', releaseKey);
    window.addEventListener('blur', release);
    reduced.addEventListener('change', release);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', release);
      document.removeEventListener('keydown', press);
      document.removeEventListener('keyup', releaseKey);
      window.removeEventListener('blur', release);
      reduced.removeEventListener('change', release);
      for (const [element, animation] of running) {
        animation.cancel();
        element.style.removeProperty('scale');
      }
    };
  }, []);
}
