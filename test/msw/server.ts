import type { RequestHandler } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

const server = setupServer();

/**
 * Intercepts `fetch` for the calling test file and fails any request without a handler, so a missing mock surfaces as a
 * test error instead of a network call. Opt in per file: server integration tests keep talking to their real listeners.
 *
 * Pass the handlers every test shares; `mock` adds ones for a single test and is reset after it.
 */
export function setupMockApi(...shared: RequestHandler[]) {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers(...shared));
  afterAll(() => server.close());
  server.use(...shared);
  return { mock: (...handlers: RequestHandler[]) => server.use(...handlers) };
}
