import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { appKeyIngest, type AppKeyIngestOptions } from '../examples/app-key-ingest/plugin.ts';
import { resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { wrapRetentionRules } from '../src/server/profiles.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const PATH = '/api/ingest/v1/recordings';
const APP_ORIGIN = 'https://app.example.com';

const staff: AuthAdapter = {
  name: 'staff',
  authenticate: (request) => (request.headers['x-staff'] ? { id: 'staff' } : undefined),
};

async function start(overrides: Partial<AppKeyIngestOptions> = {}) {
  const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  onTestFinished(() => quiet.mockRestore());
  const plugins = await resolvePlugins([
    appKeyIngest({
      apps: [
        { id: 'focus', keys: ['old-key', 'new-key'], origins: [APP_ORIGIN], retentionDays: 3 },
        { id: 'paused', keys: ['paused-key'], origins: [APP_ORIGIN], enabled: false },
      ],
      ...overrides,
    }),
  ]);
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples', {
    rules: wrapRetentionRules(plugins.retention),
  });
  const app = createApp({
    ...appDefaults(),
    auth: staff,
    store,
    plugins,
    clientDir: '/nonexistent-client',
    publicOrigin: 'https://replays.example.com',
  });
  const server = createServer((req, res) => void app(req, res));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const url = (path: string) => `http://127.0.0.1:${address.port}${path}`;
  const upload = (key: string, headers: Record<string, string> = { origin: APP_ORIGIN, 'sec-fetch-site': 'cross-site' }) =>
    fetch(url(PATH), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'x-replays-app-key': key,
        ...headers,
      },
      body: new Uint8Array(
        gzipSync(
          JSON.stringify({
            ...replay(),
            meta: { ...replay().meta, capturedAt: new Date().toISOString() },
          }),
        ),
      ),
    });
  return { store, url, upload };
}

/** The `{ id, replayUrl }` of an upload receipt; anything else fails the test. */
async function receiptOf(response: Response) {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('id' in body) || !('replayUrl' in body)) throw new Error('not a receipt');
  const { id, replayUrl } = body;
  if (typeof id !== 'string' || typeof replayUrl !== 'string') throw new Error('not a receipt');
  return { id, replayUrl };
}

describe('app-key ingest example', () => {
  it('stores an upload a staff member can then view', async () => {
    const { upload, url } = await start();
    const receipt = await receiptOf(await upload('new-key'));
    expect(receipt.replayUrl).toBe(`https://replays.example.com/r/${receipt.id}`);
    expect((await fetch(url(`/api/replays/${receipt.id}`), { headers: { 'x-staff': '1' } })).status).toBe(200);
  });

  it('accepts either key of an app during a rotation', async () => {
    const { upload } = await start();
    expect([(await upload('old-key')).status, (await upload('new-key')).status]).toEqual([201, 201]);
  });

  it('refuses a disabled app with 403', async () => {
    const { upload } = await start();
    expect((await upload('paused-key')).status).toBe(403);
  });

  it('refuses a request without Origin unless the app allows server-side uploads', async () => {
    const { upload } = await start();
    expect((await upload('new-key', {})).status).toBe(403);
  });

  it('limits each key with Retry-After', async () => {
    const { upload } = await start({ perKey: { requests: 1, windowSeconds: 60 } });
    await upload('new-key');
    const limited = await upload('new-key');
    expect([limited.status, Number(limited.headers.get('retry-after')) > 0]).toEqual([429, true]);
  });

  it('limits each client address before checking the key', async () => {
    const { upload } = await start({ perIp: { requests: 1, windowSeconds: 60 } });
    await upload('wrong-key');
    expect((await upload('new-key')).status).toBe(429);
  });

  it('applies the app retention window', async () => {
    const { upload, store } = await start();
    const { id } = await receiptOf(await upload('new-key'));
    const expiresAt = (await store.summary(id))?.expiresAt;
    expect(Math.round((Date.parse(String(expiresAt)) - Date.now()) / 86_400_000)).toBe(3);
  });

  it('keeps the app key away from staff routes', async () => {
    const { url } = await start();
    const response = await fetch(url('/api/replays'), {
      headers: { 'x-replays-app-key': 'new-key' },
    });
    expect(response.status).toBe(403);
  });
});
