import type { PluginRegistry } from '../../plugin/registry.ts';
import type { PluginMiddlewareContext, PluginRoute, StandardSchemaIssue } from '../../plugin/web-types.ts';
import type { Identity } from '../auth/types.ts';
import { parseJsonBody, readBytes } from '../http/body.ts';
import { HttpError } from '../http/errors.ts';
import { defineRoute, type RouteDefinition, RouteTable } from '../http/route.ts';

const MAX_BODY_BYTES = 1024 * 1024;

/** What a plugin route is answered with, besides the matched parameters. */
export interface PluginCall {
  request: Request;
  url: URL;
  path: string;
  base: string;
  identity: Identity | undefined;
  /** A request policy allowed this cross-origin request (src/server/request-policy.ts). */
  crossSiteAllowed: boolean;
}

const isWrite = (route: PluginRoute<unknown>) =>
  route.write ?? (typeof route.method === 'string' ? [route.method] : route.method).some((method) => method !== 'GET' && method !== 'HEAD');

const issueText = (issue: StandardSchemaIssue) => {
  const path = (issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
};

async function validBody(route: PluginRoute<unknown>, request: Request): Promise<unknown> {
  if (!route.body) return undefined;
  const parsed = parseJsonBody((await readBytes(request, MAX_BODY_BYTES)).toString('utf8'));
  const result = await route.body['~standard'].validate(parsed);
  if (result.issues) throw new HttpError(400, result.issues.map(issueText).join('; ') || 'invalid body');
  return result.value;
}

/** Runs a plugin route: the cross-site check for writes, the body schema, then the handler. */
async function invoke(route: PluginRoute<unknown>, params: Record<string, string>, call: PluginCall) {
  const site = call.request.headers.get('sec-fetch-site');
  if (isWrite(route) && site !== null && site !== 'same-origin' && !call.crossSiteAllowed) throw new HttpError(403, 'cross-site request');
  const body = await validBody(route, call.request);
  return route.handler({ request: call.request, url: call.url, path: call.path, params, base: call.base, identity: call.identity, body });
}

const routesOf = (registry: PluginRegistry, auth: 'required' | 'none') =>
  registry.routes.filter(({ value }) => (value.auth ?? 'required') === auth).map(({ value }) => value);

/** The plugins' `auth: 'required'` routes as route-table entries, after the core API. */
export function authenticatedPluginRoutes(registry: PluginRegistry): RouteDefinition[] {
  return routesOf(registry, 'required').map((route) =>
    defineRoute({
      method: route.method,
      path: route.path,
      handler: ({ request, url, path, params, base, identity, crossSiteAllowed }) =>
        invoke(route, params, { request, url, path, base, identity, crossSiteAllowed }),
    }),
  );
}

/** The plugins' `auth: 'none'` routes: answered before authentication, or undefined when none matches. */
export function publicPluginRoutes(registry: PluginRegistry) {
  const table = new RouteTable<PluginRoute<unknown>>(routesOf(registry, 'none'));
  return async (call: Omit<PluginCall, 'identity'>): Promise<Response | undefined> => {
    const found = table.match(call.request.method, call.path);
    return found ? invoke(found.route, found.params, { ...call, identity: undefined }) : undefined;
  };
}

/** `api.middleware` of one phase, in plugin order: the first `Response` answers the request. */
export async function runWebMiddleware(registry: PluginRegistry, phase: 'pre-auth' | 'post-auth', context: PluginMiddlewareContext) {
  for (const { value } of phase === 'pre-auth' ? registry.hooks.webPreAuth : registry.hooks.webPostAuth) {
    const answer = await value.handle(context);
    if (answer instanceof Response) return answer;
  }
}
