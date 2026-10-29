import { setSearch } from '../routing/navigate.ts';
import { type CompareLayout, parseCompareSearch, writeCompareSearch } from './compare-search.ts';

/**
 * "Compare with…" on a replay's own page: its URL gains the recording (a history entry), shown in `layout`, the layout
 * of the view the page will be in (Grid in Compare).
 */
export function compareWith(own: string, id: string, layout: CompareLayout = 'grid') {
  const current = parseCompareSearch(location.search, own);
  if (current.with.includes(id) || id === own) return;
  setSearch(
    writeCompareSearch(location.search, {
      ...current,
      with: [...current.with, id],
      layout: current.layout === 'single' ? layout : current.layout,
    }),
    { push: true },
  );
}
