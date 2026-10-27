import { createServer } from 'node:http';

import { expect, it } from 'vitest';

import { serveObject } from '../src/server/serve-object.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';

it('keeps all representation variants on compressed responses and their 304 revalidations', async () => {
  const storage = new MemoryStorage();
  await storage.write('replay.json', Buffer.from(JSON.stringify({ events: 'replay data '.repeat(500) })));
  const server = createServer((request, response) => {
    response.setHeader('vary', 'Host');
    void serveObject(request, response, storage, 'replay.json', 'private, no-cache', {
      etag: true,
      headers: { vary: 'Origin' },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test server address');
  try {
    for (const encoding of ['identity', 'gzip', 'br']) {
      const headers = { 'accept-encoding': encoding };
      const first = await fetch(`http://127.0.0.1:${address.port}`, { headers });
      expect(first.status).toBe(200);
      expect(first.headers.get('vary')).toBe('Host, Origin, Accept-Encoding');
      expect(first.headers.get('content-encoding')).toBe(encoding === 'identity' ? null : encoding);
      await first.arrayBuffer();
      const revalidated = await fetch(`http://127.0.0.1:${address.port}`, {
        headers: { ...headers, 'if-none-match': first.headers.get('etag')! },
      });
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.get('vary')).toBe(first.headers.get('vary'));
      expect(revalidated.headers.get('cache-control')).toBe('private, no-cache');
      expect((await revalidated.arrayBuffer()).byteLength).toBe(0);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
