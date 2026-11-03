/** Shared Motion timing for first-load, filtered and virtualized library entrances. */
export const EASE = [0.23, 1, 0.32, 1] as const;
export const ENTER_MS = 300;
export const ENTER_RISE_PX = 3;
export const STAGGER_MS = 40;
export const STAGGER_MAX_MS = 200;

/** The n-th entering item's delay (0-based). */
export const staggerDelay = (index: number, step = STAGGER_MS, max = STAGGER_MAX_MS) => Math.min(index * step, max);

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
