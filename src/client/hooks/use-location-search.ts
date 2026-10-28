import { useSyncExternalStore } from 'react';

import { currentSearch, subscribeSearch } from '../navigation.ts';

/** The page's query string, re-rendering on Back, Forward and `setSearch`. */
export function useLocationSearch() {
  return useSyncExternalStore(subscribeSearch, currentSearch, () => '');
}
