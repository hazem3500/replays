import type { IncomingMessage } from 'node:http';

import { addRoute, createRouter, findRoute, type RouterContext } from 'rou3';

import type { Identity } from '../auth/types.ts';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** What every route handler gets: the web request and the request's resolved routing and identity. */
export interface RouteContext<Params extends string = string> {
  request: Request;
  url: URL;
  /** The path without the public base (`/api/replays`). */
  path: string;
  /** Path parameters (`:id`), already checked against the route's `params` patterns. */
  params: Readonly<Record<Params, string>>;
  /** The public base of this request (`''` at a domain's root, else `/replays`). */
  base: string;
  identity: Identity;
  /** Adds attributes to the request's span (sizes, ids, never contents). */
  trace: (attributes: Record<string, string | number | boolean | undefined>) => void;
  /**
   * The Node request, only for plugin and adapter hooks of the Node-typed API (`request: IncomingMessage`). Handlers never
   * read it; it goes away when those hooks are removed (docs/api-stability.md deprecations).
   */
  legacy: { request: IncomingMessage };
}

export interface RouteDefinition<Params extends string = string> {
  method: Method | readonly Method[];
  /** rou3 syntax, base-stripped: `/api/replays/:id`. A trailing slash never matches. */
  path: string;
  /** A pattern each path parameter must match in full; a mismatch is "no route", as if the path were unknown. */
  params?: Readonly<Record<Params, RegExp>>;
  handler(context: RouteContext<Params>): Response | Promise<Response>;
}

export const defineRoute = <Params extends string = string>(route: RouteDefinition<Params>) => route;

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

/** The API's routes, matched by method and base-stripped path. Routes can be added at runtime (plugin endpoints). */
export class RouteTable {
  private readonly router: RouterContext<RouteDefinition> = createRouter();

  constructor(routes: readonly RouteDefinition[] = []) {
    for (const route of routes) this.add(route);
  }

  add(route: RouteDefinition) {
    for (const method of typeof route.method === 'string' ? [route.method] : route.method) addRoute(this.router, method, route.path, route);
  }

  match(method: string, path: string): RouteMatch | undefined {
    if (path.length > 1 && path.endsWith('/')) return undefined;
    const found = findRoute(this.router, method.toUpperCase(), path);
    if (!found) return undefined;
    const params = found.params ?? {};
    const patterns = found.data.params;
    if (patterns && Object.entries(patterns).some(([name, pattern]) => !new RegExp(`^(?:${pattern.source})$`).test(params[name] ?? '')))
      return undefined;
    return { route: found.data, params };
  }
}
