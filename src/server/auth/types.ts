import type { IncomingMessage, ServerResponse } from 'node:http';

/** Who is making a request. `id` is the stable key (kept-by records, logs); the rest is display. */
export interface Identity {
  id: string;
  email?: string;
  name?: string;
}

/**
 * An auth adapter decides who a request is from. Everything except the health check goes through it.
 *
 * - `authenticate` returns the identity, or undefined for "not signed in" (the server answers 401, or 403
 *   when the adapter has no way to sign in).
 * - `handle` (optional) lets the adapter own routes such as `/auth/login` and `/auth/callback`; it returns true
 *   when it answered the request. It runs before `authenticate`, for any path under `routes`.
 * - `loginUrl` (optional) is where a browser page load without an identity is redirected.
 */
export interface AuthAdapter {
  readonly name: string;
  authenticate(request: IncomingMessage): Promise<Identity | undefined> | Identity | undefined;
  handle?(request: IncomingMessage, response: ServerResponse, context: AuthRouteContext): Promise<boolean> | boolean;
  loginUrl?(request: IncomingMessage, context: AuthRouteContext): string | undefined;
  /** Paths (public, canonical, without the base path) that `handle` serves without an identity. */
  readonly routes?: readonly string[];
}

export interface AuthRouteContext {
  /** The base path the app is served under ('' at the root). */
  base: string;
  /** The public origin used for redirect URIs, e.g. `https://replays.example.com`. */
  publicOrigin?: string;
}

/** A module loaded by `AUTH_MODE=plugin` (`AUTH_PLUGIN=./my-auth.mjs`): its default export is this factory. */
export type AuthPluginFactory = (env: NodeJS.ProcessEnv) => AuthAdapter | Promise<AuthAdapter>;
