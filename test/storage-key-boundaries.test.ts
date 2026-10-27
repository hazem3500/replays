import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { assertKey, MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

describe('storage key boundary', () => {
  it.each(['', '/', '/absolute', 'trailing/', 'a//b', '.', '..', '../secret', 'a/../secret', 'a/./b', 'a\\b', 'a\0b', 'a'.repeat(513)])(
    'rejects %j',
    (key) => {
      expect(() => assertKey(key)).toThrow('invalid storage key');
    },
  );

  it.each(['replay/replay.json', '_suites/suite.json', '.hidden/file', 'a'.repeat(512)])('accepts %j', (key) => {
    expect(assertKey(key)).toBe(key);
  });

  it('refuses encoded traversal at the HTTP boundary without reading the target', async () => {
    const storage = new MemoryStorage();
    const store = new ReplayStore(storage, '/nonexistent-samples');
    await store.save(replay());
    await storage.write('secret.json', 'private target');
    const read = vi.spyOn(storage, 'read');
    const app = createApp({ ...appDefaults(), store, clientDir: '/nonexistent-client' });
    const server = createServer((request, response) => void app(request, response));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      for (const path of [
        '/api/replays/%2e%2e%2fsecret',
        '/api/replays/test-replay%2f..%2fsecret',
        '/api/replays/..%5csecret',
        '/api/replays/test-replay%00',
      ]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('private target');
      }
      expect(read).not.toHaveBeenCalledWith('secret.json');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
