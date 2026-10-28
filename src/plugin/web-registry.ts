import type { PluginMiddleware, PluginMiddlewareContext, PluginRoute, PluginRouteMethod } from './web-types.ts';

const METHODS: ReadonlySet<string> = new Set<PluginRouteMethod>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SEGMENT = /^(?:[a-z0-9][a-z0-9._-]*|:[a-zA-Z][a-zA-Z0-9]*)$/;
const SPLAT = /^\*\*:[a-zA-Z][a-zA-Z0-9]*$/;

/** A registration problem; registry.ts turns it into a `PluginError` naming the plugin. */
export class WebRegistrationError extends Error {
  readonly code: 'invalid-registration' | 'conflict';
  constructor(message: string, code: 'invalid-registration' | 'conflict' = 'invalid-registration') {
    super(message);
    this.code = code;
  }
}

const methodsOf = (route: PluginRoute<unknown>): string[] => (typeof route.method === 'string' ? [route.method] : [...route.method]);

const isMethod = (method: string): method is PluginRouteMethod => METHODS.has(method);

function checkMethods(route: PluginRoute<unknown>): readonly PluginRouteMethod[] {
  const methods = methodsOf(route);
  const known = methods.filter(isMethod);
  if (!methods.length || known.length !== methods.length)
    throw new WebRegistrationError(`route method must be one of ${[...METHODS].join(', ')}`);
  return Object.freeze(known);
}

function checkPath(path: unknown, plugin: string) {
  const prefix = `/api/plugins/${plugin}`;
  const inside = typeof path === 'string' && (path === prefix || path.startsWith(`${prefix}/`));
  const segments = inside ? path.slice(prefix.length).split('/').slice(1) : [];
  const last = segments.length - 1;
  if (!inside || !segments.every((segment, index) => SEGMENT.test(segment) || (index === last && SPLAT.test(segment))))
    throw new WebRegistrationError(`route path must be ${prefix} or below it, with :name segments and an optional final **:name`);
}

function checkOptions(route: PluginRoute<unknown>) {
  if (typeof route.handler !== 'function') throw new WebRegistrationError('route handler must be a function');
  if (route.auth !== undefined && route.auth !== 'required' && route.auth !== 'none')
    throw new WebRegistrationError('route auth must be "required" or "none"');
  if (route.write !== undefined && typeof route.write !== 'boolean') throw new WebRegistrationError('route write must be a boolean');
  if (route.body !== undefined && typeof Reflect.get(route.body['~standard'] ?? {}, 'validate') !== 'function')
    throw new WebRegistrationError('route body must be a Standard Schema (Zod 4, Valibot, ArkType…)');
}

/** Checks an `api.route` registration: a known method, a path under `/api/plugins/<plugin>`, a handler, sane options. */
export function validateRoute(route: PluginRoute<unknown>, plugin: string): PluginRoute<unknown> {
  if (!route || typeof route !== 'object') throw new WebRegistrationError('route needs { method, path, handler }');
  const method = checkMethods(route);
  checkPath(route.path, plugin);
  checkOptions(route);
  return Object.freeze({ ...route, method });
}

/** Refuses a second registration of the same method and path. */
export function assertDistinctRoute(existing: readonly PluginRoute<unknown>[], route: PluginRoute<unknown>): void {
  const taken = existing.find((other) => other.path === route.path && methodsOf(other).some((method) => methodsOf(route).includes(method)));
  if (taken) throw new WebRegistrationError(`route ${route.path} is already registered for that method`, 'conflict');
}

export function validateMiddleware(middleware: PluginMiddleware): PluginMiddleware {
  if (!middleware || typeof middleware !== 'object') throw new WebRegistrationError('middleware needs { phase, handle }');
  if (middleware.phase !== 'pre-auth' && middleware.phase !== 'post-auth')
    throw new WebRegistrationError('middleware phase must be "pre-auth" or "post-auth"');
  if (typeof middleware.handle !== 'function') throw new WebRegistrationError('middleware handle must be a function');
  return Object.freeze({ phase: middleware.phase, handle: (context: PluginMiddlewareContext) => middleware.handle(context) });
}
