import { useSyncExternalStore } from 'react';

const COARSE_QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void) {
  const list = matchMedia(COARSE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** Hit-target size in CSS pixels for timeline annotations: larger under a coarse pointer. */
export function useHighlightTargetSize() {
  return useSyncExternalStore(
    subscribe,
    () => (matchMedia(COARSE_QUERY).matches ? 44 : 28),
    () => 28,
  );
}
