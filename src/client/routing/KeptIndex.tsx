import { useRouterState } from '@tanstack/react-router';
import { Activity, useState } from 'react';

import { ReplayIndex } from '../ReplayIndex.tsx';
import { indexHref, rememberIndexSearch } from './links.ts';
import { setPageUrl } from './navigate.ts';
import { parseSearch, stringifySearch } from './search.ts';

const isRenderedView = (data: unknown): data is { view: 'list' | 'grid' } =>
  typeof data === 'object' && data !== null && 'view' in data && (data.view === 'list' || data.view === 'grid');

/**
 * The index, drawn by the root layout: it mounts the first time `/` is shown and then stays (hidden) behind viewer
 * pages, so Back returns to it as it was: same list, same scroll, the card you opened still there to morph into.
 * The page keeps its filters as state and writes them back to the address; an index address it did not write itself
 * (Back to other filters, a link) remounts it on that address.
 */
export function KeptIndex() {
  const search = useRouterState({
    select: (state) => {
      const match = state.matches.find((candidate) => candidate.routeId === '/');
      return match ? stringifySearch(match.search) : undefined;
    },
  });
  const rendered = useRouterState({
    select: (state) => {
      const data: unknown = state.matches.find((candidate) => candidate.routeId === '/')?.loaderData;
      return isRenderedView(data) ? data.view : undefined;
    },
  });
  const [kept, setKept] = useState(search);
  // why: an address the page did not write itself (Back to other filters, a link) remounts it.
  const [written, setWritten] = useState(search);
  const [generation, setGeneration] = useState(0);
  if (search !== undefined && search !== kept) {
    setKept(search);
    if (search !== written) {
      setWritten(search);
      setGeneration((value) => value + 1);
    }
  }
  const onSearch = (next: string) => {
    rememberIndexSearch(next);
    const normal = stringifySearch(parseSearch(next));
    if (normal === kept) return;
    setWritten(normal);
    setPageUrl(`${indexHref()}${normal}`);
  };
  if (kept === undefined) return null;
  return (
    <Activity mode={search === undefined ? 'hidden' : 'visible'}>
      <ReplayIndex key={generation} search={kept} onSearch={onSearch} {...(rendered ? { rendered } : {})} />
    </Activity>
  );
}
