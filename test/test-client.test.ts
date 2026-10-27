import { describe, expect, it } from 'vitest';

import { createTestClient } from '../src/server/testing/client.ts';

describe('createTestClient', () => {
  it('serves a fetch handler over loopback with the request it was sent', async () => {
    const client = await createTestClient({
      fetch: async (request) =>
        Response.json({ method: request.method, path: new URL(request.url).pathname, body: await request.text() }, { status: 202 }),
    });
    try {
      const response = await client.fetch('/api/echo', { method: 'POST', body: 'hello' });
      expect([response.status, await response.json()]).toEqual([202, { method: 'POST', path: '/api/echo', body: 'hello' }]);
    } finally {
      await client.close();
    }
  });
});
