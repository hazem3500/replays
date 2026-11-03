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
let inPlace = false;
let sequence = 0;

export const currentTransition = () => active ?? (document as DocumentWithTransition).activeViewTransition ?? undefined;

/** Records the transition this app started, until it has finished. */
export function follow(transition: PageTransition) {
  active = transition;
  void transition.finished
    .catch(() => {})
    .then(() => {
      if (active === transition) active = undefined;
    });
}

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
