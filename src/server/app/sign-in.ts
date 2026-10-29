import type { IncomingMessage, ServerResponse } from 'node:http';

import { signInReturn, type SignInConfig } from '../../shared/sign-in.ts';
import type { AuthAdapter, AuthRouteContext } from '../auth/types.ts';
import { publicPath } from '../base-path.ts';
import { isBrowserNavigation, send, sendJson } from '../http/send.ts';

/** The request as the auth gate sees it: its public base, parsed URL and app path. */
export interface GateRequest {
  request: IncomingMessage;
  response: ServerResponse;
  raw: URL;
  path: string;
  base: string;
}

/** A browser recovery may only return to a page, never another auth or machine endpoint. */
function signInDestination(next: string | null, base: string, path: string): string {
  const destination = signInReturn(next, publicPath('/', base));
  const target = new URL(destination, 'http://replays.invalid');
  const targetPath = base && target.pathname.startsWith(`${base}/`) ? target.pathname.slice(base.length) : target.pathname;
  const blocked = target.pathname === publicPath(path, base) || /^\/(api|auth|internal|_plugins)(\/|$)/.test(targetPath);
  return blocked ? publicPath('/', base) : destination;
}

/** The request with only its `url` replaced; the real request is not mutated. */
function withUrl(request: IncomingMessage, url: string): IncomingMessage {
  return new Proxy(request, {
    get(target, key): unknown {
      return key === 'url' ? url : Reflect.get(target, key, target);
    },
  });
}

function redirect(response: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  response.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  response.end();
}

/**
 * Answers a request without an identity: a browser page load goes to the adapter's login URL, anything else gets a 401
 * (an adapter that can sign in) or 403. A recovery load of the sign-in path keeps its normalized `next` page.
 */
export function refuseAnonymous(gate: GateRequest, auth: AuthAdapter, signIn: SignInConfig | undefined, context: AuthRouteContext): void {
  const { request, response, raw, path, base } = gate;
  const recovery = signIn?.path === path && request.method === 'GET' && isBrowserNavigation(request);
  // why: loginUrl adapters (including OIDC) return to this endpoint after their callback, keeping the normalized next page.
  const loginRequest =
    recovery && signIn
      ? withUrl(
          request,
          `${publicPath(signIn.path, base)}?${new URLSearchParams({ next: signInDestination(raw.searchParams.get('next'), base, signIn.path) })}`,
        )
      : request;
  const login = auth.loginUrl?.(loginRequest, context);
  if (login && request.method === 'GET' && isBrowserNavigation(request) && (recovery || !path.startsWith('/api/'))) {
    redirect(response, login);
    return;
  }
  send(response, login ? 401 : 403, login ? 'sign in required' : 'forbidden');
}

/** The sign-in path once signed in: back to the page the browser came from (GET only). */
export function returnFromSignIn(gate: GateRequest, signIn: SignInConfig, vary: string | undefined): void {
  const { request, response, raw, base } = gate;
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method not allowed' });
    return;
  }
  redirect(response, signInDestination(raw.searchParams.get('next'), base, signIn.path), vary ? { vary } : {});
}

/** The public, credential-free CLI auth contract; works before sign-in and never fails the request. */
export async function sendCliCapabilities(response: ServerResponse, auth: AuthAdapter, context: AuthRouteContext): Promise<void> {
  const capability = await Promise.resolve()
    .then(() => auth.cliDeviceAuth?.(context))
    .catch(() => null);
  sendJson(response, 200, { auth: auth.name, deviceFlow: capability ?? null }, { cacheControl: 'no-store' });
}
