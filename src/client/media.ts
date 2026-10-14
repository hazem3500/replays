import { useEffect, useState } from 'react';

/** Phones and short landscape screens: the viewer stacks into one scrolling column (styles.css uses the same query). */
export const STACKED_QUERY = '(max-width: 840px), (max-height: 560px)';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Phones (portrait ≤ 720 px, or landscape ≤ 520 px tall): the viewer becomes a fixed
 * app shell — compact topbar, player, transport and one tabbed panel — and the page never scrolls.
 */
export const MOBILE_QUERY = '(max-width: 720px), (max-height: 520px)';
