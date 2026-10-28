import { setSearch } from '../navigation.ts';
import { parseCompareSearch, writeCompareSearch } from './search.ts';

/** "Compare with…" on a replay's own page: its URL gains the recording, shown in a grid (a history entry). */
export function compareWith(own: string, id: string) {
  const current = parseCompareSearch(location.search, own);
  if (current.with.includes(id) || id === own) return;
  setSearch(
    writeCompareSearch(location.search, {
      ...current,
      with: [...current.with, id],
      layout: current.layout === 'single' ? 'grid' : current.layout,
    }),
    { push: true },
  );
}
