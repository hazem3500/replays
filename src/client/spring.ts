import { animate, motionValue } from 'motion';

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  onUpdate: (value: number) => void;
}

/** A retargetable Motion spring for the now-divider's decorative grip and snapped boundary. */
export function createSpring({ stiffness = 170, damping = 26, mass = 1.4, onUpdate }: SpringOptions) {
  const current = motionValue(0);
  let initialized = false;
  let animation: ReturnType<typeof animate> | undefined;
  return {
    /** Moves toward the next pose; direct pointer geometry and reduced motion apply immediately. */
    set(next: number, immediate = false) {
      animation?.stop();
      animation = undefined;
      if (immediate || !initialized || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        initialized = true;
        current.jump(next);
        onUpdate(next);
        return;
      }
      animation = animate(current, next, { type: 'spring', stiffness, damping, mass, restDelta: 0.1, restSpeed: 0.5, onUpdate });
    },
    get value() {
      return initialized ? current.get() : Number.NaN;
    },
    stop() {
      animation?.stop();
      animation = undefined;
    },
  };
}
