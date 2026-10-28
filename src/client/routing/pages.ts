import { lazy } from 'react';

import { editsQuery } from '../edits.ts';
import { queryClient, replayQuery, suiteQuery } from '../queries.ts';
import type { Page } from './page-key.ts';

/*
 * The index ships alone; the viewer (rrweb + player), the editor, the suite workspace and the comparison are split
 * chunks. Each loader is memoised so a route can start the download before React asks for it, and each records its
 * module so a page whose code is in renders at once.
 */

function once<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

/**
 * For React.lazy: a thenable that settles synchronously when the chunk has already loaded. A plain `.then()` always
 * settles a microtask later, so lazy would suspend for one tick even for a loaded chunk and React would commit the
 * Suspense fallback (a second skeleton flashing in right after the first was swapped out).
 */
function settled<T, R>(loaded: () => T | undefined, load: () => Promise<T>, map: (value: T) => R): Promise<R> {
  const ready = loaded();
  if (!ready) return load().then(map);
  const result = map(ready);
  // why: React.lazy only calls `then`; the cast is for its Promise-typed signature.
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- why: a synchronous thenable is the point (see above).
    then<A = R>(onFulfilled?: ((value: R) => A | PromiseLike<A>) | null) {
      return Promise.resolve(onFulfilled ? onFulfilled(result) : (result as unknown as A));
    },
  } as unknown as Promise<R>;
}

let viewerModule: typeof import('../Viewer.tsx') | undefined;
let editorModule: typeof import('../editor/Editor.tsx') | undefined;
let suiteModule: typeof import('../suite/SuiteWorkspace.tsx') | undefined;

export const loadViewer = once(() => import('../Viewer.tsx').then((module) => (viewerModule = module)));
export const loadEditor = once(() => import('../editor/Editor.tsx').then((module) => (editorModule = module)));
export const loadSuiteWorkspace = once(() => import('../suite/SuiteWorkspace.tsx').then((module) => (suiteModule = module)));

export const viewerLoaded = () => Boolean(viewerModule);
export const editorLoaded = () => Boolean(editorModule);
export const suiteLoaded = () => Boolean(suiteModule);

export const Viewer = lazy(() =>
  settled(
    () => viewerModule,
    loadViewer,
    (module) => ({ default: module.EditedViewer }),
  ),
);
export const Editor = lazy(() =>
  settled(
    () => editorModule,
    loadEditor,
    (module) => ({ default: module.Editor }),
  ),
);
export const SuiteWorkspace = lazy(() =>
  settled(
    () => suiteModule,
    loadSuiteWorkspace,
    (module) => ({ default: module.SuiteWorkspace }),
  ),
);
export const ReplayComparePage = lazy(() =>
  import('../compare/ReplayComparePage.tsx').then((module) => ({ default: module.ReplayComparePage })),
);

/** A page's code: started as soon as its route matches, in parallel with its data. */
export function loadPageCode(page: Page) {
  if (page.kind === 'suite') return loadSuiteWorkspace();
  if (page.kind === 'edit') return loadEditor();
  if (page.kind === 'replay') return loadViewer();
  return Promise.resolve();
}

/** A query's data when the cache has it or a request for it is already on the way (else nothing to wait for). */
function inCache(key: readonly unknown[]) {
  const state = queryClient.getQueryState(key);
  return state && (state.data !== undefined || state.fetchStatus === 'fetching')
    ? queryClient.ensureQueryData({ queryKey: key })
    : undefined;
}

/**
 * What a page change waits for (within a short budget, transitions/page-motion.ts) before it renders the page: its
 * code, and its data when the cache has it or a prefetch is on the way. Uncached data is left to the page, which
 * shows its skeleton meanwhile.
 */
export function preparePage(page: Page): Promise<unknown> {
  if (page.kind === 'suite')
    return Promise.all([
      loadSuiteWorkspace(),
      page.suiteId ? inCache(suiteQuery(page.suiteId).queryKey) : undefined,
      page.replayId ? inCache(replayQuery(page.replayId).queryKey) : undefined,
    ]);
  if (page.kind === 'edit' && page.replayId) return Promise.all([loadEditor(), inCache(replayQuery(page.replayId).queryKey)]);
  if (page.kind === 'replay' && page.replayId)
    return Promise.all([loadViewer(), inCache(replayQuery(page.replayId).queryKey), inCache(editsQuery(page.replayId).queryKey)]);
  return Promise.resolve();
}
