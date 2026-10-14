/**
 * A tiny rAF spring for things that should feel like they have weight (the now divider's grip and line).
 * Semi-implicit Euler at a fixed 1/120 s step; the loop stops once position and velocity settle, and under
 * reduced motion every target is applied directly. Transforms only: `onUpdate` writes the value to the DOM.
 */
export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  onUpdate: (value: number) => void;
}

const STEP = 1 / 120;

export function createSpring({ stiffness = 170, damping = 26, mass = 1.4, onUpdate }: SpringOptions) {
  let value = Number.NaN;
  let target = 0;
  let velocity = 0;
  let frame = 0;
  let last = 0;

  const tick = (now: number) => {
    let elapsed = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (elapsed > 0) {
      const dt = Math.min(STEP, elapsed);
      const force = -stiffness * (value - target) - damping * velocity;
      velocity += (force / mass) * dt;
      value += velocity * dt;
      elapsed -= dt;
    }
    if (Math.abs(value - target) < 0.1 && Math.abs(velocity) < 0.5) {
      value = target;
      velocity = 0;
      frame = 0;
      onUpdate(value);
      return;
    }
    onUpdate(value);
    frame = requestAnimationFrame(tick);
  };

  return {
    /** Moves toward `next`; `immediate` (or reduced motion, or no previous value) jumps there. */
    set(next: number, immediate = false) {
      target = next;
      if (immediate || Number.isNaN(value) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        value = next;
        velocity = 0;
        onUpdate(value);
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    get value() {
      return value;
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
