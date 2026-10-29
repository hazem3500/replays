import { type ComponentType, lazy } from 'react';

/**
 * A page that ships as its own chunk (the viewer with rrweb, the editor, the suite workspace). `preload` starts the
 * download (route loaders call it, so code and data arrive together); `Component` renders it. Route components stay
 * in the main bundle and render these, so a navigation commits (and its page transition starts) without waiting for
 * the chunk: the page's skeleton is the Suspense fallback meanwhile. Once loaded, `Component` renders the page itself,
 * never suspending (React.lazy would, for one tick, and commit a second skeleton right after the first).
 */
export function lazyPage<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  let Loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const preload = () =>
    (pending ??= load().then((module) => {
      Loaded = pick(module);
      return Loaded;
    }));
  const Lazy = lazy(() => preload().then((page) => ({ default: page })));
  function Component(props: P) {
    return Loaded ? <Loaded {...props} /> : <Lazy {...props} />;
  }
  return { Component, preload, loaded: () => Loaded !== undefined };
}
