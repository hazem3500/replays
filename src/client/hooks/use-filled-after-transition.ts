import { useEffect, useState } from 'react';

import { afterPageTransition, currentTransition, swappingInPlace } from '../transitions/state.ts';

/**
 * False while the page transition that mounted the caller runs, then true. Long lists (the step rail, the inspector's
 * rows) render their shell inside the transition and fill once it has landed: the click shows motion sooner, and no
 * list render competes with the animation for the main thread.
 */
export function useFilledAfterTransition() {
  // why: a run switch crossfades whole panels in place: they render complete inside it.
  const [filled, setFilled] = useState(() => !currentTransition() || swappingInPlace());
  useEffect(() => {
    if (filled) return;
    let live = true;
    void afterPageTransition().then(() => live && setFilled(true));
    return () => {
      live = false;
    };
  }, [filled]);
  return filled;
}
