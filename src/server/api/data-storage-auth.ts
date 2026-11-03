import { IncomingMessage, ServerResponse } from 'node:http';

import type { PluginRegistry } from '../../plugin/registry.ts';
import { runRequestPhase, type RequestPhaseContext } from '../app/request-phase.ts';
import { toWebRequest } from '../http/node.ts';
import type { Identity } from '../auth/types.ts';
import { classifyError } from '../http/errors.ts';
import { applyRequestPolicy } from '../request-policy.ts';
import { routeAllowed } from './upload-endpoints.ts';
import type { ApiServices } from './services.ts';

type ReplayMethod = 'GET' | 'DELETE';

/** Reuses canonical pre-auth dispatch, authentication, identity, scopes, CSRF and application authorization. */
export type ReplayAuthorizer = (gate: RequestPhaseContext, csrfAllowed: boolean) => Promise<Identity | undefined>;
const BODY_HEADERS = new Set(['content-length', 'content-type', 'transfer-encoding']);

/** Derived authorization requests have no body and cannot change the incoming request or its headers. */
function replayRequest(source: IncomingMessage, path: string, method: ReplayMethod): IncomingMessage {
  const request = new IncomingMessage(source.socket);
  request.method = method;
  request.url = path;
  request.headers = Object.fromEntries(
    Object.entries(source.headers)
      .filter(([key]) => !BODY_HEADERS.has(key))
      .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
  request.rawHeaders = source.rawHeaders.flatMap((value, index, headers) =>
    index % 2 === 0 && !BODY_HEADERS.has(value.toLowerCase()) ? [value, headers[index + 1] ?? ''] : [],
  );
  request.httpVersion = source.httpVersion;
  request.httpVersionMajor = source.httpVersionMajor;
  request.httpVersionMinor = source.httpVersionMinor;
  request.complete = true;
  request.push(null);
  return request;
}

function replayGate(
  registry: PluginRegistry,
  authorize: ReplayAuthorizer,
  method: ReplayMethod,
): NonNullable<ApiServices['canReadReplay']> {
  return async (hooks, identity, id, base) => {
    const path = `/api/replays/${id}`;
    const request = replayRequest(hooks.request, `${base}${path}`, method);
    const response = new ServerResponse(request);
    let web: Request | undefined;
    const gate = {
      request,
      response,
      path,
      base,
      raw: new URL(request.url ?? '/', 'http://app'),
      webRequest: () => (web ??= toWebRequest(request, response)),
    };
    try {
      const policy = applyRequestPolicy(registry, request, response, path);
      if (policy.handled) return false;
      const authenticated = await authorize(gate, policy.csrfAllowed);
      if (!authenticated || authenticated.id !== identity.id || responseClosed(response)) return false;
      if (routeAllowed(registry, identity, method, path)) return false;
      const result = await runRequestPhase(registry, 'post-auth', gate, authenticated);
      if (result instanceof Response) await result.body?.cancel();
      return !result && !responseClosed(response);
    } catch (error) {
      const { status } = classifyError(error);
      if (status === 401 || status === 403 || status === 404) return false;
      throw error;
    } finally {
      if (!response.writableEnded) response.end();
    }
  };
}

function responseClosed(response: ServerResponse): boolean {
  return response.writableEnded || response.headersSent;
}

/** Trash IDs follow canonical replay read policy, including the host's application authorization. */
export function replayReadGate(registry: PluginRegistry, authorize: ReplayAuthorizer): NonNullable<ApiServices['canReadReplay']> {
  return replayGate(registry, authorize, 'GET');
}

/** Bulk trash cannot grant permissions that the corresponding individual DELETE would refuse. */
export function replayDeleteGate(registry: PluginRegistry, authorize: ReplayAuthorizer): NonNullable<ApiServices['canDeleteReplay']> {
  return replayGate(registry, authorize, 'DELETE');
}
