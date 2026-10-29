import { useSyncExternalStore } from 'react';

/** Phones and short landscape screens: the viewer stacks into one scrolling column (styles.css uses the same query). */
export const STACKED_QUERY = '(max-width: 840px), (max-height: 560px)';

/** Whether a media query matches, following changes. A server render (and the hydration that follows it) sees `false`. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/**
 * Phones (portrait ≤ 720 px, or landscape ≤ 520 px tall): the viewer becomes a fixed
 * app shell — compact topbar, player, transport and one tabbed panel — and the page never scrolls.
 */
export const MOBILE_QUERY = '(max-width: 720px), (max-height: 520px)';
