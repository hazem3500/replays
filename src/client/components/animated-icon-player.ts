/**
 * Playback for animated icons, kept free of React and the DOM so the rules are unit-tested
 * (test/animated-icon.test.ts): an icon plays once per request, never loops, never restarts mid-play, and stays
 * still under reduced motion, during key repeat, and for a request that follows the previous one too closely
 * (continuous playback ticking through steps).
 */

export const PLAYING_ATTRIBUTE = 'data-playing';

/** A request this soon after the previous one (or a key auto-repeat) is dropped: the icon stays still. */
export const COALESCE_MS = 250;

export interface PlayTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  /** Starts the visual gesture and returns its cancellation. */
  startMotion?(): () => void;
}

export interface PlayerEnvironment {
  reducedMotion(): boolean;
  now(): number;
  /** Time of the last auto-repeated keydown (holding ] / [ / arrows). */
  lastKeyRepeatAt(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

let keyRepeatAt = Number.NEGATIVE_INFINITY;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat) keyRepeatAt = performance.now();
    },
    { capture: true },
  );
}

const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;

export const browserEnvironment: PlayerEnvironment = {
  reducedMotion: () => reducedMotionQuery?.matches ?? false,
  now: () => performance.now(),
  lastKeyRepeatAt: () => keyRepeatAt,
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export interface IconPlayer {
  /** Plays the icon once; false when it was skipped (reduced motion, key repeat, already playing, too soon). */
  play(options?: { coalesce?: boolean }): boolean;
  /** Stops at rest (unmount). */
  cancel(): void;
  readonly playing: boolean;
}

export function createIconPlayer(target: PlayTarget, ms: number, environment: PlayerEnvironment = browserEnvironment): IconPlayer {
  let timer: unknown;
  let playing = false;
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let stopMotion: (() => void) | undefined;

  const stop = () => {
    if (timer !== undefined) environment.clearTimeout(timer);
    timer = undefined;
    playing = false;
    stopMotion?.();
    stopMotion = undefined;
    target.removeAttribute(PLAYING_ATTRIBUTE);
  };

  return {
    get playing() {
      return playing;
    },
    play({ coalesce = false } = {}) {
      const now = environment.now();
      const sincePrevious = now - lastRequestAt;
      lastRequestAt = now;
      if (environment.reducedMotion()) return false;
      if (now - environment.lastKeyRepeatAt() < COALESCE_MS) return false;
      if (coalesce && sincePrevious < COALESCE_MS) return false;
      if (playing) return false;
      playing = true;
      target.removeAttribute(PLAYING_ATTRIBUTE);
      target.setAttribute(PLAYING_ATTRIBUTE, '');
      stopMotion = target.startMotion?.();
      // why: a small scheduling margin lets every Motion part finish before its static pose is restored.
      timer = environment.setTimeout(stop, ms + 40);
      return true;
    },
    cancel: stop,
  };
}

/**
 * Change detector for `trigger="state"`: true only when the key changes to a new value that is not a rest key
 * (undefined, null, false). The value at mount is the baseline, so a freshly rendered icon stays still, and
 * `play={isActive ? index : false}` plays when a row becomes active, not when it stops being active.
 */
export function createKeyWatcher(initial: unknown) {
  let previous = initial;
  return (next: unknown) => {
    if (Object.is(previous, next)) return false;
    previous = next;
    return next !== undefined && next !== null && next !== false;
  };
}
