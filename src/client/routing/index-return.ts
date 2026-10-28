import type { AnyRouter } from '@tanstack/react-router';

import { indexHref } from './links.ts';
import { parseSearch, stringifySearch } from './search.ts';

/*
 * "All replays" from a page opened from the index steps back in history when it would land on the same list: the
 * index's own entry (and its scroll) is reused instead of stacking another.
 */

/** The history position of the page opened from the index (replacing its address keeps it), and the index left. */
let returnable: { index: number; search: string } | undefined;

const normal = (search: string) => stringifySearch(parseSearch(search));

export function installIndexReturn(router: AnyRouter) {
  router.subscribe('onResolved', ({ fromLocation, toLocation }) => {
    if (toLocation.pathname === '/') returnable = undefined;
    else if (fromLocation?.pathname === '/') returnable = { index: toLocation.state.__TSR_index, search: normal(fromLocation.searchStr) };
  });
}

export function returnsToKeptIndex(router: AnyRouter, url: URL) {
  return Boolean(
    returnable &&
    url.pathname === new URL(indexHref(), url).pathname &&
    normal(url.search) === returnable.search &&
    router.state.location.state.__TSR_index === returnable.index,
  );
}
