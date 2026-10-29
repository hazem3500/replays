/*
 * why: our node:http server renders a page through the TanStack Start server entry (src/server/pages/start.ts), which
 * is a separately built bundle. What one page render needs from the server (the request's deployment and an
 * in-process API call carrying its credentials) travels through this registry, keyed by an id in a request header
 * the server overwrites, so a client can never pick another request's context. Server-safe and dependency-free.
 */

/** The deployment one page is rendered for: what the router's context needs on the server. */
export interface PageDeployment {
  /** `''` at the root of a domain, else a path prefix such as `/replays`. */
  base: string;
  name: string;
}

export interface PageContext {
  deployment: PageDeployment;
  /** `GET <base>/api/<path>` answered in process, with the page request's cookies and authorization. */
  api(path: string, init?: RequestInit): Promise<Response>;
}

export const PAGE_HEADER = 'x-replays-page';

const key = Symbol.for('replays.pages');
const store = globalThis as { [key]?: Map<string, PageContext> };
const contexts = (store[key] ??= new Map<string, PageContext>());

export const pageContexts = {
  set: (id: string, context: PageContext) => void contexts.set(id, context),
  delete: (id: string) => void contexts.delete(id),
  get: (id: string | null | undefined) => (id ? contexts.get(id) : undefined),
};
