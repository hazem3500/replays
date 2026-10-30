import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginRegistry } from '../plugin/registry.ts';

/** Keep policy Vary fields when core responses or host hooks add their own cache variations. */
function vary(response: ServerResponse, fields: string[]) {
  const original = response.writeHead.bind(response);
  response.writeHead = ((status: number, reasonOrHeaders?: string | Record<string, unknown> | unknown[], extra?: unknown) => {
    const supplied = typeof reasonOrHeaders === 'string' ? extra : reasonOrHeaders;
    // why: writeHead accepts either a header object or raw name/value pairs. Copy it before merging.
    const headers: Record<string, unknown> = {};
    if (Array.isArray(supplied)) {
      for (let index = 0; index < supplied.length; index += 2) headers[String(supplied[index])] = supplied[index + 1];
    } else if (supplied) Object.assign(headers, supplied);
    const existing = [response.getHeader('vary')];
    for (const key of Object.keys(headers))
      if (key.toLowerCase() === 'vary') {
        existing.push(String(headers[key]));
        delete headers[key];
      }
    const tokens = [
      ...existing.flatMap((value) =>
        String(value ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      ),
      ...fields,
    ];
    headers.vary = [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()].join(', ');
    return typeof reasonOrHeaders === 'string' ? original(status, reasonOrHeaders, headers as never) : original(status, headers as never);
  }) as ServerResponse['writeHead'];
  response.setHeader('vary', [response.getHeader('vary'), ...fields].filter(Boolean).join(', '));
}

/** A handled preflight/denial, or an actual exact match eligible for the narrow CSRF exception. */
export function applyRequestPolicy(
  registry: PluginRegistry,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): { handled: boolean; csrfAllowed: boolean } {
  const policies = registry.requestPolicies.filter(({ value }) => value.path === path);
  if (!policies.length) return { handled: false, csrfAllowed: false };
  const preflight = request.method === 'OPTIONS';
  vary(response, preflight ? ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'] : ['Origin']);
  const origin = request.headers.origin;
  const method = preflight ? request.headers['access-control-request-method'] : request.method;
  const policy =
    typeof origin === 'string' && typeof method === 'string'
      ? policies.find(({ value }) => value.methods.includes(method) && value.origins.includes(origin))?.value
      : undefined;
  const deny = () => {
    response.writeHead(403, { 'cache-control': 'no-store' });
    response.end('cross-origin request denied');
    return { handled: true, csrfAllowed: false };
  };
  if (preflight) {
    if (!policy) return deny();
    const rawHeaders = request.headers['access-control-request-headers'];
    if (rawHeaders !== undefined && typeof rawHeaders !== 'string') return deny();
    const requested = rawHeaders === undefined ? [] : rawHeaders.split(',').map((header) => header.trim().toLowerCase());
    if (requested.some((header) => !header || !policy.headers.includes(header))) return deny();
    response.setHeader('access-control-allow-origin', origin!);
    if (policy.credentials) response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('access-control-allow-methods', method!);
    if (requested.length) response.setHeader('access-control-allow-headers', [...new Set(requested)].join(', '));
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return { handled: true, csrfAllowed: false };
  }
  if (policy) {
    response.setHeader('access-control-allow-origin', origin!);
    if (policy.credentials) response.setHeader('access-control-allow-credentials', 'true');
    return { handled: false, csrfAllowed: true };
  }
  // why: reads keep their existing behavior but receive no CORS permission. Non-browser clients without Origin use normal CSRF.
  if (origin !== undefined && request.headers['sec-fetch-site'] !== 'same-origin' && !['GET', 'HEAD'].includes(request.method ?? 'GET'))
    return deny();
  return { handled: false, csrfAllowed: false };
}
