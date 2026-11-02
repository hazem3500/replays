import { type ComponentType, lazy } from 'react';

/**
 * A page that ships as its own chunk (the viewer with rrweb, the editor, the suite workspace). `preload` starts the
 * download (route loaders call it, so code and data arrive together); `Component` renders it. Route components stay
 * in the main bundle and render these, so a navigation commits (and its page transition starts) without waiting for
 * the chunk: the route's skeleton is the Suspense fallback meanwhile.
 *
 * Once loaded, `Component` renders without suspending: React.lazy only calls `then`, and a plain `.then()` settles a
 * microtask later, which would commit the fallback for one tick (a second skeleton flashing in right after the first).
 */
export function lazyPage<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  let module: M | undefined;
  let pending: Promise<M> | undefined;
  const preload = () => (pending ??= load().then((loaded) => (module = loaded)));
  const Component = lazy(() => {
    if (!module) return preload().then((loaded) => ({ default: pick(loaded) }));
    const result = { default: pick(module) };
    return {
      // oxlint-disable-next-line unicorn/no-thenable -- why: React.lazy only calls `then`; a settled one renders a loaded page without a one-tick suspend.
      then<A>(onFulfilled?: ((value: typeof result) => A | PromiseLike<A>) | null) {
        return Promise.resolve(onFulfilled ? onFulfilled(result) : (result as unknown as A));
      },
    } as unknown as Promise<typeof result>;
  });
  return { Component, preload, loaded: () => module !== undefined };
}
