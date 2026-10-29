import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendWebResponse, toWebRequest } from '../http/node.ts';
import type { AnyAuthAdapter, AuthAdapter, WebAuthAdapter } from './types.ts';

/**
 * The request's method, URL and headers as a web `Request`, for reading credentials (no body). Built from `headers`, so it
 * works for `fakeRequest` too; a header value `Headers` refuses (hostile input) is left out rather than thrown on.
 */
function credentialsRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    try {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    } catch {
      headers.delete(name);
    }
  }
  const host = headers.get('host') ?? 'replays.invalid';
  return new Request(new URL(request.url ?? '/', `http://${host}`), { method: request.method ?? 'GET', headers });
}

/** A `WebAuthAdapter`: it brings `authenticateRequest` and not the Node `authenticate`. */
export const isWebAuthAdapter = (adapter: AnyAuthAdapter): adapter is WebAuthAdapter =>
  'authenticateRequest' in adapter && typeof adapter.authenticateRequest === 'function' && !('authenticate' in adapter);

function nodeHandle(adapter: WebAuthAdapter): AuthAdapter['handle'] {
  if (!adapter.handleRequest) return undefined;
  return async (request: IncomingMessage, response: ServerResponse, context) => {
    const page = await adapter.handleRequest?.(toWebRequest(request, response), context);
    if (!page) return false;
    await sendWebResponse(response, page, request.method);
    return true;
  };
}

/**
 * The adapter the Node server calls, for either shape: a `WebAuthAdapter` is wrapped (identities pass through unchanged,
 * `authScopes` included); an `AuthAdapter` is returned as is.
 */
export function toNodeAuthAdapter(adapter: AnyAuthAdapter): AuthAdapter {
  if (!isWebAuthAdapter(adapter)) return adapter;
  const handle = nodeHandle(adapter);
  return {
    name: adapter.name,
    ...(adapter.signIn ? { signIn: adapter.signIn } : {}),
    ...(adapter.routes ? { routes: adapter.routes } : {}),
    authenticate: (request) => adapter.authenticateRequest(credentialsRequest(request)),
    ...(handle ? { handle } : {}),
    ...(adapter.loginUrlFor ? { loginUrl: (request, context) => adapter.loginUrlFor?.(credentialsRequest(request), context) } : {}),
    ...(adapter.cliDeviceAuth ? { cliDeviceAuth: (context) => adapter.cliDeviceAuth?.(context) } : {}),
  };
}
