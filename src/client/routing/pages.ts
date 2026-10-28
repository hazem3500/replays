import { editsQuery } from '../edits.ts';
import { queryClient, replayQuery, suiteQuery } from '../queries.ts';
import { lazyPage } from './lazy-page.ts';
import type { Page } from './page-key.ts';

let features: Promise<void> | undefined;
/**
 * The viewer's built-in features (comments: provider, tab, seek-bar markers), registered with the code that renders
 * them, so the index's bundle never carries the player (rrweb) they depend on.
 */
const viewerFeatures = () => (features ??= import('../comments/feature.tsx').then((module) => module.registerCommentsFeature()));

const withFeatures =
  <M>(load: () => Promise<M>) =>
  () =>
    Promise.all([load(), viewerFeatures()]).then(([module]) => module);

/** The pages that ship as their own chunks; the index ships in the main bundle. Route loaders warm them. */
export const viewerPage = lazyPage(
  withFeatures(() => import('../Viewer.tsx')),
  (module) => module.EditedViewer,
);
export const editorPage = lazyPage(
  withFeatures(() => import('../editor/Editor.tsx')),
  (module) => module.Editor,
);
export const suitePage = lazyPage(
  withFeatures(() => import('../suite/SuiteWorkspace.tsx')),
  (module) => module.SuiteWorkspace,
);
export const comparePage = lazyPage(
  withFeatures(() => import('../compare/ReplayComparePage.tsx')),
  (module) => module.ReplayComparePage,
);

/** Code for a page, warmed by its route's loader; a failure surfaces when the page renders. */
export const warm = (page: { preload: () => Promise<unknown> }) => void page.preload().catch(() => undefined);

/** A query's data when the cache has it or a request for it is already on the way (else nothing to wait for). */
function inCache(key: readonly unknown[]) {
  const state = queryClient.getQueryState(key);
  return state && (state.data !== undefined || state.fetchStatus === 'fetching') ? queryClient.ensureQueryData({ queryKey: key }) : undefined;
}

/**
 * What a page change waits for (within a short budget, transitions/page-motion.ts) before it renders the page: its
 * code, and its data when the cache has it or a prefetch is on the way. Uncached data is left to the page, which
 * shows its skeleton meanwhile.
 */
export function preparePage(page: Page): Promise<unknown> {
  if (page.kind === 'suite')
    return Promise.all([
      suitePage.preload(),
      page.suiteId ? inCache(suiteQuery(page.suiteId).queryKey) : undefined,
      page.replayId ? inCache(replayQuery(page.replayId).queryKey) : undefined,
    ]);
  if (page.kind === 'edit' && page.replayId) return Promise.all([editorPage.preload(), inCache(replayQuery(page.replayId).queryKey)]);
  if (page.kind === 'replay' && page.replayId)
    return Promise.all([viewerPage.preload(), inCache(replayQuery(page.replayId).queryKey), inCache(editsQuery(page.replayId).queryKey)]);
  return Promise.resolve();
}
