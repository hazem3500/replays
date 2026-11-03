/* why: the page transition in flight, for the views that pace themselves on it: the player waits for the morph to start,
 * long lists fill once it has landed. page-motion.ts starts page changes' transitions, swap.ts a suite's run switches.
 */

type DocumentWithTransition = Document & { activeViewTransition?: ViewTransition | null };

export interface PageTransition {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
  skipTransition: () => void;
}

let active: PageTransition | undefined;
let animating: PageTransition | undefined;
let inPlace = false;
let sequence = 0;
const listeners = new Set<() => void>();

function setAnimating(transition: PageTransition | undefined) {
  if (animating === transition) return;
  animating = transition;
  for (const listener of listeners) listener();
}

export const currentTransition = () => active ?? (document as DocumentWithTransition).activeViewTransition ?? undefined;

/** Records the transition this app started, until it has finished. */
export function follow(transition: PageTransition) {
  active = transition;
  void transition.ready.then(
    () => {
      if (active === transition) setAnimating(transition);
    },
    () => {},
  );
  void transition.finished
    .catch(() => {})
    .then(() => {
      if (active === transition) active = undefined;
      if (animating === transition) setAnimating(undefined);
    });
}

/** Subscribes to the captured page transition starting and landing. */
export function subscribeAnimating(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True between a page transition's capture and its landing.
 * invariant: Chrome aborts a transition whose captured destination element leaves the document, so pages keep it until then.
 */
export const pageTransitionAnimating = () => animating !== undefined;

/** Skips the running transition (a newer change lands at once) and returns this change's turn. */
export function nextTurn() {
  active?.skipTransition();
  return ++sequence;
}

export const isTurn = (turn: number) => turn === sequence;

/** Resolves when the running page transition has started animating (at once when none runs). */
export function afterMorphStart(): Promise<void> {
  const transition = currentTransition();
  return transition
    ? transition.ready.then(
        () => {},
        () => {},
      )
    : Promise.resolve();
}

/** Resolves when the running page transition has finished (at once when none runs). */
export function afterPageTransition(): Promise<void> {
  const transition = currentTransition();
  return transition
    ? transition.finished.then(
        () => {},
        () => {},
      )
    : Promise.resolve();
}

export const pageTransitionRunning = () => Boolean(currentTransition());

export function setSwappingInPlace(value: boolean) {
  inPlace = value;
}

/** True while an in-place swap renders: the player mounts at once, lists fill at once. */
export const swappingInPlace = () => inPlace;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const supportsTransitions = () => typeof document.startViewTransition === 'function' && !reducedMotion();
