import { setSearch } from '../routing/navigate.ts';
import { type PageViewInput, resolvePageView } from '../views/page-view.ts';
import { writeViewSearch } from '../views/resolve.ts';
import { useLocationSearch } from './use-location-search.ts';

/**
 * The page's view, following `?view=` through Back and Forward. `select` replaces the address (no history entry): only
 * the `view` key changes, so the playhead, the compared recordings and their players stay.
 */
export function usePageView(input: Omit<PageViewInput, 'search'> & { comparison?: boolean }) {
  const search = useLocationSearch();
  const resolved = resolvePageView({ ...input, search: input.comparison ? '?view=compare' : search });
  const select = (id: string) => {
    if (!input.comparison) setSearch(writeViewSearch(location.search, id, resolved.fallback.id));
  };
  return { ...resolved, select };
}
