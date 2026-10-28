import { SignInError, SignInLink } from './sign-in.tsx';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Activity, lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Toaster } from '@/components/ui/sonner.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

import { editingEnabled, productName } from './config.ts';
import { ReplayIndex } from './ReplayIndex.tsx';
import { editsQuery } from './edits.ts';
import { queryClient, replayQuery, suiteQuery } from './queries.ts';
import { currentIndexGeneration, currentRoute, installNavigation, setRoutePreparer, subscribeRoute } from './navigation.ts';
import { indexHref, replayHref, type Route } from './route.ts';
import { notify } from './toast.ts';
import { ThemeContext, useTheme } from './theme.tsx';
import { EditorSkeleton, LoadingSwap, ViewerSkeleton } from './ViewerSkeleton.tsx';
import { useLocationSearch } from './hooks/use-location-search.ts';
import { parseCompareSearch } from './compare/search.ts';

// The index ships alone; the viewer (rrweb + player) and the suite workspace are split chunks.
// Each loader is memoised so the route can start the download before React asks for it.
let viewerLoaded = false;
let viewerModule: typeof import('./Viewer.tsx') | undefined;
let suiteModule: typeof import('./suite/SuiteWorkspace.tsx') | undefined;
let editorModule: typeof import('./editor/Editor.tsx') | undefined;
const loadViewer = once(() => import('./Viewer.tsx').then((module) => ((viewerLoaded = true), (viewerModule = module))));
const loadEditor = once(() => import('./editor/Editor.tsx').then((module) => (editorModule = module)));
const loadSuiteWorkspace = once(() => import('./suite/SuiteWorkspace.tsx').then((module) => (suiteModule = module)));
const ReplayComparePage = lazy(() => import('./compare/ReplayComparePage.tsx').then((module) => ({ default: module.ReplayComparePage })));
const Viewer = lazy(() =>
  settled(
    () => viewerModule,
    loadViewer,
    (module) => ({ default: module.EditedViewer }),
  ),
);
const Editor = lazy(() =>
  settled(
    () => editorModule,
    loadEditor,
    (module) => ({ default: module.Editor }),
  ),
);
const SuiteWorkspace = lazy(() =>
  settled(
    () => suiteModule,
    loadSuiteWorkspace,
    (module) => ({ default: module.SuiteWorkspace }),
  ),
);

/**
 * For React.lazy: a thenable that settles synchronously when the chunk has already loaded. A plain `.then()`
 * always settles a microtask later, so lazy would suspend for one tick even for a loaded chunk and React would
 * commit the Suspense fallback (a second skeleton flashing in right after the first was swapped out).
 */
function settled<T, R>(loaded: () => T | undefined, load: () => Promise<T>, map: (value: T) => R): Promise<R> {
  const ready = loaded();
  if (!ready) return load().then(map);
  const result = map(ready);
  // React.lazy only calls `then`; the cast is for its Promise-typed signature.
  return {
    // oxlint-disable-next-line unicorn/no-thenable
    then<A = R>(onFulfilled?: ((value: R) => A | PromiseLike<A>) | null) {
      return Promise.resolve(onFulfilled ? onFulfilled(result) : (result as unknown as A));
    },
  } as unknown as Promise<R>;
}

function once<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

/** A query's data when the cache has it or a request for it is already on the way (else nothing to wait for). */
function inCache(key: readonly unknown[]) {
  const state = queryClient.getQueryState(key);
  return state && (state.data !== undefined || state.fetchStatus === 'fetching')
    ? queryClient.ensureQueryData({ queryKey: key })
    : undefined;
}

/**
 * Readies a page before a same-document navigation renders it (navigation.ts waits a short budget for this):
 * its code, and its data when the Query cache has it or a prefetch is already on the way. Uncached data is
 * left to the page itself, which shows the skeleton meanwhile.
 */
function prepareRoute(next: Route) {
  if (next.kind === 'index') return Promise.resolve();
  if (next.kind === 'suite')
    return Promise.all([
      loadSuiteWorkspace(),
      inCache(suiteQuery(next.id).queryKey),
      next.replayId ? inCache(replayQuery(next.replayId).queryKey) : undefined,
    ]);
  if (next.kind === 'edit') return Promise.all([loadEditor(), inCache(replayQuery(next.id).queryKey)]);
  return Promise.all([loadViewer(), inCache(replayQuery(next.id).queryKey), inCache(editsQuery(next.id).queryKey)]);
}

installNavigation();
setRoutePreparer(prepareRoute);

export function App() {
  const route = useSyncExternalStore(subscribeRoute, currentRoute);
  const indexGeneration = useSyncExternalStore(subscribeRoute, currentIndexGeneration);
  // Old edit links open playback; keep their time, original-view choice and step/comment anchor.
  useEffect(() => {
    if (route.kind !== 'edit' && !editingEnabled() && /\/r\/[^/]+\/edit\/?$/.test(location.pathname))
      history.replaceState(history.state, '', `${location.pathname.replace(/\/edit\/?$/, '')}${location.search}${location.hash}`);
  }, [route]);
  // The index mounts the first time it is shown and then stays (hidden) behind viewer pages, so Back returns
  // to it as it was: same list, same scroll, the card you opened still there to morph into.
  const [indexShown, setIndexShown] = useState(route.kind === 'index');
  if (route.kind === 'index' && !indexShown) setIndexShown(true);
  // Fetch the route's chunk in parallel with its data instead of after it; the index warms the viewer's when idle.
  if (route.kind === 'suite') void loadSuiteWorkspace();
  else if (route.kind === 'edit') void loadEditor();
  else if (route.kind !== 'index') void loadViewer();
  useEffect(() => {
    if (route.kind !== 'index') return;
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
    const handle = idle(() => void loadViewer().catch(() => undefined));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle);
  }, [route.kind]);
  // The same element across page changes, so a hidden index doesn't re-render when the route does.
  const index = useMemo(() => <ReplayIndex key={indexGeneration} />, [indexGeneration]);
  const themeControls = useTheme();
  // One provider: hints open after 500 ms, then neighbours open instantly for 400 ms.
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={themeControls}>
        <TooltipProvider delay={500} closeDelay={0} timeout={400}>
          {indexShown ? <Activity mode={route.kind === 'index' ? 'visible' : 'hidden'}>{index}</Activity> : null}
          {route.kind === 'suite' ? (
            <SuitePage key={route.id} id={route.id} {...(route.replayId ? { replayId: route.replayId } : {})} />
          ) : route.kind === 'replay' ? (
            <ReplayPage key={route.id} id={route.id} />
          ) : route.kind === 'edit' ? (
            <EditPage key={`edit:${route.id}`} id={route.id} />
          ) : null}
          <Toaster />
        </TooltipProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}

function SuitePage({ id, replayId }: { id: string; replayId?: string }) {
  // Loaded code and a cached suite render the workspace at once (also inside a page transition).
  const [ready, setReady] = useState(() => Boolean(suiteModule) && queryClient.getQueryData(suiteQuery(id).queryKey) !== undefined);
  // Start the workspace's queries (read from index.html's preloads) while the transition runs.
  useEffect(() => {
    void queryClient.prefetchQuery(suiteQuery(id));
    if (replayId) void queryClient.prefetchQuery(replayQuery(replayId));
  }, [id, replayId]);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadSuiteWorkspace()
      .catch(() => undefined)
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  // Fast loads skip the delayed skeleton; ready content replaces it immediately.
  return (
    <LoadingSwap ready={ready} skeleton={<ViewerSkeleton suite />}>
      <Suspense fallback={<ViewerSkeleton suite />}>
        <SuiteWorkspace id={id} {...(replayId ? { replayId } : {})} />
      </Suspense>
    </LoadingSwap>
  );
}

/** `/r/<id>`: the replay on its own, or with `?with=` the same viewer comparing it with others. */
function ReplayPage({ id }: { id: string }) {
  if (parseCompareSearch(useLocationSearch(), id).with.length === 0) return <SingleReplayPage id={id} />;
  return (
    <Suspense fallback={<ViewerSkeleton label="Loading recordings" />}>
      <ReplayComparePage id={id} />
    </Suspense>
  );
}

function SingleReplayPage({ id }: { id: string }) {
  // Cached bundles (an in-page revisit) render at once; Query aborts the request if the page goes away.
  const { data: bundle, error: failure } = useQuery(replayQuery(id));
  // The saved edits come with it (small, revalidated); a failed load shows the replay as recorded.
  const edits = useQuery(editsQuery(id));
  const editsSettled = edits.data !== undefined || edits.isError;
  useEffect(() => {
    if (edits.isError && bundle && !(edits.error instanceof SignInError))
      notify('Could not load this replay’s edits', 'info', 'Showing it as recorded.');
  }, [bundle, edits.isError, edits.error]);
  const authFailure = [failure, edits.error].find((candidate) => candidate instanceof SignInError);
  const error = (authFailure ?? failure)?.message ?? '';
  // A page crossfade never delays ready content or forces a loading placeholder to finish animating.
  const [ready, setReady] = useState(() => viewerLoaded);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadViewer()
      .catch(() => undefined)
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);

  useEffect(() => {
    document.title = bundle ? `${bundle.meta.title} · ${productName()}` : productName();
  }, [bundle]);

  if (error) {
    return (
      <main className="state-shell">
        <a className="state-brand" href={indexHref()}>
          {productName()}
        </a>
        <section className="state-content" role="alert">
          <span className="state-kicker">Could not open replay</span>
          <h1>{error}</h1>
          <SignInLink error={authFailure ?? failure ?? edits.error} />
          <p>
            Replay <code>{id}</code> may have expired or the link may be incomplete.
          </p>
          <div className="state-actions">
            <a className="button" href={indexHref()}>
              Back to all replays
            </a>
            <button type="button" className="button secondary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </section>
      </main>
    );
  }

  // Fast loads skip the delayed skeleton; ready content replaces it immediately.
  return (
    <LoadingSwap ready={Boolean(bundle) && ready && editsSettled} skeleton={<ViewerSkeleton />}>
      {bundle && editsSettled ? (
        <Suspense fallback={<ViewerSkeleton />}>
          <Viewer bundle={bundle} edits={edits.data} />
        </Suspense>
      ) : null}
    </LoadingSwap>
  );
}

/** Edit mode: the original bundle and the freshest saved edits (always refetched, so a save is never made blind). */
function EditPage({ id }: { id: string }) {
  const { data: bundle, error: failure } = useQuery(replayQuery(id));
  const edits = useQuery({ ...editsQuery(id), staleTime: 0, refetchOnMount: 'always' });
  const [ready, setReady] = useState(() => Boolean(editorModule));
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadEditor()
      .catch(() => undefined)
      .then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  useEffect(() => {
    document.title = bundle ? `Edit · ${bundle.meta.title} · replays` : 'replays';
  }, [bundle]);
  const authFailure = [failure, edits.error].find((candidate) => candidate instanceof SignInError);
  const error = (authFailure ?? failure ?? edits.error)?.message ?? '';
  if (error) {
    return (
      <main className="state-shell">
        <a className="state-brand" href={indexHref()}>
          replays
        </a>
        <section className="state-content" role="alert">
          <span className="state-kicker">Could not open edit mode</span>
          <h1>{error}</h1>
          <SignInLink error={authFailure ?? failure ?? edits.error} />
          <div className="state-actions">
            <a className="button" href={replayHref(id)}>
              Back to the replay
            </a>
            <button type="button" className="button secondary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </section>
      </main>
    );
  }
  // Fresh edits only: a cached copy could be older than someone else's save.
  const loaded = edits.data && !edits.isFetching ? edits.data : undefined;
  return (
    <LoadingSwap ready={Boolean(bundle && loaded) && ready} skeleton={<EditorSkeleton />}>
      {bundle && loaded ? (
        <Suspense fallback={<EditorSkeleton />}>
          <Editor bundle={bundle} loaded={loaded} />
        </Suspense>
      ) : null}
    </LoadingSwap>
  );
}
