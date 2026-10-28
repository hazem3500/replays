import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';

import { type Deployment, readDeployment } from './deployment.ts';
import { queryClient as browserQueryClient } from './queries.ts';
import { routeTree } from './route-tree.gen.ts';
import { NotFoundPage, RouteErrorPage } from './routing/states.tsx';
import { parseSearch, stringifySearch } from './routing/search.ts';

/**
 * The app's router. The browser calls it once (main.tsx) with the app's Query cache; a server render would call it
 * per request with that request's deployment and a fresh cache (`createQueryClient()`), so nothing here touches the DOM.
 */
export function getRouter() {
  return createAppRouter({ queryClient: browserQueryClient, deployment: readDeployment() });
}

/** The router for a given deployment and cache (tests pass a memory history; a server render, the request's). */
export function createAppRouter({
  queryClient,
  deployment,
  history,
}: {
  queryClient: QueryClient;
  deployment: Deployment;
  history?: RouterHistory;
}) {
  const router = createRouter({
    routeTree,
    ...(history ? { history } : {}),
    context: { queryClient, deployment },
    // why: one build serves every base, chosen per host at runtime: a rewrite, not `basepath` (fixed at build under Start).
    ...(deployment.base ? { rewrite: baseRewrite(deployment.base) } : {}),
    parseSearch,
    stringifySearch,
    // why: Query owns freshness; loaders only start requests and read the cache.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
  });
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: true });
  return router;
}

/** The app's addresses under `base` (`/replays/r/x` is `/r/x` to the routes); `/` is `${base}/`. */
function baseRewrite(base: string) {
  return {
    input: ({ url }: { url: URL }) => {
      if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return url;
      const inside = new URL(url);
      inside.pathname = url.pathname.slice(base.length) || '/';
      return inside;
    },
    output: ({ url }: { url: URL }) => {
      const outside = new URL(url);
      outside.pathname = `${base}${url.pathname}`;
      return outside;
    },
  };
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
