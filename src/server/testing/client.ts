import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { NodeRequest, sendNodeResponse } from 'srvx/node';

/** A Node request handler, as `createApp()` returns. */
export type NodeRequestHandler = (request: IncomingMessage, response: ServerResponse) => unknown;
/** A web-standard handler: `createApp().fetch`, a Start server entry, or any `{ fetch }` object. */
export interface FetchHandler {
  fetch(request: Request): Response | Promise<Response>;
}

export interface TestClient {
  /** `http://127.0.0.1:<port>`; the handler listens on loopback for the client's lifetime. */
  readonly origin: string;
  /** `fetch` with paths resolved against `origin`, so `client.fetch('/api/replays')` works. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

/**
 * A fetch-style client for an app under test, over a real loopback socket: the same bytes a CLI, an agent or a browser sees,
 * for either handler shape. The web-standard twin of `fakeRequest` (which builds a bare `IncomingMessage` for adapters).
 *
 *   const client = await createTestClient(createApp(options));
 *   expect((await client.fetch('/api/replays')).status).toBe(200);
 *   await client.close();
 */
export async function createTestClient(handler: NodeRequestHandler | FetchHandler): Promise<TestClient> {
  const listener: NodeRequestHandler =
    typeof handler === 'function'
      ? handler
      : async (request, response) => {
          try {
            await sendNodeResponse(response, await handler.fetch(new NodeRequest({ req: request, res: response })));
          } catch (error) {
            response.destroy(error instanceof Error ? error : new Error(String(error)));
          }
        };
  const server: Server = createServer((request, response) => void listener(request, response));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    fetch: (input, init) => fetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
