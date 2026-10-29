import { createIsomorphicFn } from '@tanstack/react-start';

import { setServerApi } from '../api/request.ts';
import { readDeployment } from '../deployment.ts';
import { setServerCookie, setServerMeta } from '../page-meta.ts';
import { createQueryClient, queryClient } from '../queries.ts';
import { type AppRouter, createAppRouter } from '../router.tsx';
import { installClient } from './install-client.ts';

/**
 * The router Start creates: per request on the server, with a fresh Query cache and the request's deployment; once in
 * the browser, with the app's cache (its DB collections live on it) and the page's own deployment.
 */
const make = createIsomorphicFn()
  .server(async (): Promise<AppRouter> => {
    const { serverPageContext } = await import('./server-context.ts');
    setServerApi((path, init) => serverPageContext().api(path, init));
    setServerMeta((name) => serverPageContext().metas[name]);
    setServerCookie(() => serverPageContext().cookie);
    return createAppRouter({ queryClient: createQueryClient(), deployment: serverPageContext().deployment });
  })
  .client((): Promise<AppRouter> => Promise.resolve(installClient(createAppRouter({ queryClient, deployment: readDeployment() }))));

export function getRouter() {
  return make();
}
