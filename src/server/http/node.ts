import type { IncomingMessage, ServerResponse } from 'node:http';

import { NodeRequest } from 'srvx/node';

/**
 * The server edge: the one place a Node request becomes a web `Request` and a web `Response` goes back out. Everything behind
 * it (the route table, src/server/api/*) is web-standard, so any fetch host (a TanStack Start server route included) can mount
 * it unchanged.
 */
export function toWebRequest(request: IncomingMessage, response: ServerResponse): Request {
  return new NodeRequest({ req: request, res: response });
}

/** Writes `page` to `response`. A `Vary` the server already set (`Host` with per-host bases) is kept after the response's own. */
export async function sendWebResponse(response: ServerResponse, page: Response, method = 'GET') {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of page.headers) if (name !== 'set-cookie') headers[name] = value;
  const cookies = page.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  const existing = response.getHeader('vary');
  if (typeof existing === 'string' && existing) headers.vary = headers.vary ? `${String(headers.vary)}, ${existing}` : existing;
  response.writeHead(page.status, headers);
  if (!page.body || method === 'HEAD') {
    response.end();
    return;
  }
  const reader = page.body.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (response.destroyed) {
      await reader.cancel().catch(() => null);
      return;
    }
    if (!response.write(next.value)) await drained(response);
  }
  response.end();
}

/** Resolves once `response` can take more bytes, or is gone. */
function drained(response: ServerResponse) {
  return new Promise<void>((resolve) => {
    const done = () => {
      response.off('drain', done);
      response.off('close', done);
      resolve();
    };
    response.once('drain', done);
    response.once('close', done);
  });
}
