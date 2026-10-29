import { createFileRoute } from '@tanstack/react-router';

import { indexSearchSchema } from '../../shared/schemas/search.ts';
import { indexReplaysQuery, indexSuitesQuery } from '../index/index-queries.ts';
import { filtersFromSearch, INDEX_SUITES_URL, renderedView, searchFromFilters } from '../index/route-state.ts';
import { indexPage } from '../routing/index-page.ts';
import { stringifySearch } from '../routing/search.ts';

/**
 * The index. The root layout draws its page (routing/KeptIndex.tsx), which keeps it mounted behind viewer pages so Back
 * finds the same list, scroll and card; this route owns its address: filters, sort, view and purpose.
 */
export const Route = createFileRoute('/')({
  validateSearch: indexSearchSchema,
  loaderDeps: ({ search }) => ({ list: searchFromFilters(filtersFromSearch(stringifySearch(search))), forMe: search.for === 'me' }),
  loader: async ({ context: { queryClient }, deps }) => {
    const code = indexPage.preload();
    // why: SSR must render the list directly; a streamed empty fallback would require JavaScript to reveal it.
    if (typeof document === 'undefined') await code;
    else void code.catch(() => {});
    // invariant: the view travels as loader data, so hydration renders what the server did.
    const loaded = { view: renderedView() };
    /* why: a server render puts the lists in the page (For me needs this browser's linked handles); the browser's index
       fetches and revalidates its own, so a navigation here never waits. */
    if (typeof document !== 'undefined' || deps.forMe) return loaded;
    await Promise.all([queryClient.query(indexReplaysQuery(deps.list)), queryClient.query(indexSuitesQuery(INDEX_SUITES_URL))]).catch(
      () => {},
    );
    return loaded;
  },
  component: () => null,
});
