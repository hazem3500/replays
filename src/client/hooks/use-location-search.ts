import { useSearch } from '@tanstack/react-router';

import { stringifySearch } from '../routing/search.ts';

/** The page's query string as the router shows it (re-renders on Back, Forward and `setSearch`). */
export function useLocationSearch() {
  return useSearch({ strict: false, select: (search) => stringifySearch(search) });
}
