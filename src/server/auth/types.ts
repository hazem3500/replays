import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SignInConfig } from '../../shared/sign-in.ts';
export type { SignInConfig } from '../../shared/sign-in.ts';

/** Who is making a request. `id` is the stable key (kept-by records, logs); the rest is display. */
export interface Identity {
  id: string;
  /** Trusted role claims supplied by the host auth adapter (for workspace plugin administration). */
  roles?: readonly string[];
  email?: string;
  name?: string;
  /** An https image URL for the person's avatar (shown beside their comments); optional. */
  avatarUrl?: string;
  /** Populated only for narrowly scoped API tokens; ordinary browser sessions remain unrestricted. */
  authScopes?: readonly string[];
  /** Expiry of a verified bearer token, in Unix seconds. */
  authExpiresAt?: number;
  /**
   * Confines the identity to these exact routes: every other request answers 403 before the CSRF check, application
   * authorization, post-auth hooks, plugin routes or core dispatch. Absent means unrestricted (subject to `authScopes`).
   */
  capabilities?: IdentityCapabilities;
}

/** One permitted request: an uppercase method and a canonical path without the deployment's base prefix. */
export interface RouteGrant {
  readonly method: string;
  readonly path: string;
}

export interface IdentityCapabilities {
  /** Exact matches only: no patterns, and `GET` does not imply `HEAD`. Empty allows nothing. */
  readonly routes: readonly RouteGrant[];
}

/** Public, credential-free description of a device flow explicitly enabled by an auth adapter. */
export interface CliDeviceAuthCapability {
  type: 'oidc-device';
  issuer: string;
  clientId: string;
  audience: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  scopes: readonly ['openid', 'email', 'profile', 'replays:upload'];
  /** RFC 8707 resource indicator, equal to the verified audience and bound to this server deployment. */
  resource: string;
}

/**
 * An auth adapter decides who a request is from. Health and the public, credential-free CLI capability probe are
 * available before authentication; protected viewer and upload routes go through it.
 *
 * - `authenticate` returns the identity, or undefined for "not signed in" (the server answers 401, or 403
 *   when the adapter has no way to sign in).
 * - `handle` (optional) lets the adapter own routes such as `/auth/login` and `/auth/callback`; it returns true
 *   when it answered the request. It runs before `authenticate`, for any path under `routes`.
 * - `loginUrl` (optional) is where a browser page load without an identity is redirected.
 */
export interface AuthAdapter {
  readonly name: string;
  /** Opt into browser recovery through an authenticated top-level return endpoint. */
  readonly signIn?: SignInConfig;
  authenticate(request: IncomingMessage): Promise<Identity | undefined> | Identity | undefined;
  handle?(request: IncomingMessage, response: ServerResponse, context: AuthRouteContext): Promise<boolean> | boolean;
  loginUrl?(request: IncomingMessage, context: AuthRouteContext): string | undefined;
  /** Present only when this adapter can issue and validate a dedicated replay-upload-only token. */
  cliDeviceAuth?(context: AuthRouteContext): Promise<CliDeviceAuthCapability | undefined> | CliDeviceAuthCapability | undefined;
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
export type AuthPluginFactory = (env: NodeJS.ProcessEnv) => AnyAuthAdapter | Promise<AnyAuthAdapter>;

/**
 * An auth adapter over web-standard `Request`/`Response`, which runs on any fetch host. Same contract as `AuthAdapter`:
 * `authenticateRequest` returns the identity (including `authScopes`) or undefined, `handleRequest` answers the adapter's
 * own `routes` (return a `Response` when it answered), and `loginUrlFor` is where a browser page load without one goes.
 */
export interface WebAuthAdapter {
  readonly name: string;
  readonly signIn?: SignInConfig;
  authenticateRequest(request: Request): Promise<Identity | undefined> | Identity | undefined;
  handleRequest?(request: Request, context: AuthRouteContext): Promise<Response | undefined> | Response | undefined;
  loginUrlFor?(request: Request, context: AuthRouteContext): string | undefined;
  cliDeviceAuth?(context: AuthRouteContext): Promise<CliDeviceAuthCapability | undefined> | CliDeviceAuthCapability | undefined;
  readonly routes?: readonly string[];
}

/** Either adapter shape: the server normalizes a `WebAuthAdapter` (auth/web.ts) where it takes one. */
export type AnyAuthAdapter = AuthAdapter | WebAuthAdapter;
