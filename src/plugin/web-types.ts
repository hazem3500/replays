import type { Identity } from '../server/auth/types.ts';

/** A validation issue in the Standard Schema shape (standardschema.dev). */
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

/** A schema any Standard Schema library provides (Zod 4, Valibot, ArkType): the server only calls `validate`. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type PluginRouteMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** What a plugin route's handler gets. Web-standard: the same handler runs on any fetch host. */
export interface PluginRouteContext<Body = undefined> {
  request: Request;
  url: URL;
  /** The path without the public base: what `path` was matched against. */
  path: string;
  /** Path parameters by name (`:id`, and a splat's name for `**:rest`). */
  params: Readonly<Record<string, string>>;
  /** The public base of this request (`''` at a domain's root, else `/replays`). */
  base: string;
  /** The signed-in person; undefined only on an `auth: 'none'` route. */
  identity: Identity | undefined;
  /** The parsed, validated JSON body when the route has a `body` schema (the request body is then consumed); else undefined. */
  body: Body;
}

/**
 * A plugin's HTTP route (`api.route`). `path` is matched without the public base, in rou3 syntax (`:id`, a trailing
 * `**:rest` splat), and must sit under `/api/plugins/<plugin name>`. A trailing slash never matches.
 */
export interface PluginRoute<Body = undefined> {
  method: PluginRouteMethod | readonly PluginRouteMethod[];
  path: string;
  /** `required` (default): the same authentication, scopes and hooks as core routes. `none`: before authentication. */
  auth?: 'required' | 'none';
  /**
   * A state-changing route (default: any method but GET and HEAD). Cross-site browser requests are refused for it, on
   * `auth: 'none'` routes too, unless a request policy allows the origin.
   */
  write?: boolean;
  /** Validates the JSON body (at most 1 MiB) once, before the handler; a failure answers 400 with the issues. */
  body?: StandardSchemaV1<unknown, Body>;
  handler(context: PluginRouteContext<Body>): Response | Promise<Response>;
}

export interface PluginMiddlewareContext {
  request: Request;
  url: URL;
  path: string;
  base: string;
  /** Present in the `post-auth` phase. */
  identity?: Identity;
}

/**
 * A request interceptor (`api.middleware`): it runs in its phase for every request and either answers it (return a
 * `Response`) or lets it continue (return nothing). It must not read the request body; routes own it.
 */
export interface PluginMiddleware {
  phase: 'pre-auth' | 'post-auth';
  handle(context: PluginMiddlewareContext): Response | undefined | void | Promise<Response | undefined | void>;
}
