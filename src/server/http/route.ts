import { addRoute, createRouter, findRoute, type RouterContext } from 'rou3';

import type { Identity } from '../auth/types.ts';
import type { HookRequests } from '../plugin-runtime.ts';

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
  /** A request policy allowed this cross-origin request (src/server/request-policy.ts). */
  crossSiteAllowed: boolean;
  /** The request as plugin hooks receive it: their deprecated Node `request` and their `webRequest`. */
  hooks: HookRequests;
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

/** What the table matches on: any route shape with methods, a path and optional parameter patterns. */
export interface MatchableRoute {
  method: string | readonly string[];
  path: string;
  params?: Readonly<Record<string, RegExp>> | undefined;
}

export interface RouteMatch<Route extends MatchableRoute = RouteDefinition> {
  route: Route;
  params: Record<string, string>;
}

/** Routes matched by method and base-stripped path. Routes can be added at runtime (plugin endpoints). */
export class RouteTable<Route extends MatchableRoute = RouteDefinition> {
  private readonly router: RouterContext<Route> = createRouter();

  constructor(routes: readonly Route[] = []) {
    for (const route of routes) this.add(route);
  }

  add(route: Route) {
    for (const method of typeof route.method === 'string' ? [route.method] : route.method) addRoute(this.router, method, route.path, route);
  }

  match(method: string, path: string): RouteMatch<Route> | undefined {
    if (path.length > 1 && path.endsWith('/')) return undefined;
    const found = findRoute(this.router, method.toUpperCase(), path);
    if (!found) return undefined;
    const params = found.params ?? {};
    const patterns: Readonly<Record<string, RegExp>> = found.data.params ?? {};
    if (Object.entries(patterns).some(([name, pattern]) => !new RegExp(`^(?:${pattern.source})$`).test(params[name] ?? '')))
      return undefined;
    return { route: found.data, params };
  }
}
