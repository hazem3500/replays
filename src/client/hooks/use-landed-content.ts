import { useState, useSyncExternalStore } from 'react';

import { pageTransitionAnimating, subscribeAnimating } from '../transitions/state.ts';

/**
 * Whether ready content may replace its loading layout. Content ready before the page transition captures its
 * destination renders at once; content that arrives mid-flight waits for the landing, so the morph never loses the
 * skeleton frame it is flying to.
 */
export function useLandedContent(ready: boolean) {
  const animating = useSyncExternalStore(subscribeAnimating, pageTransitionAnimating, () => false);
  const [shown, setShown] = useState(false);
  const show = ready && (shown || !animating);
  // why: once shown, content stays through later transitions; it is never swapped back to its skeleton.
  if (show && !shown) setShown(true);
  return show;
}
