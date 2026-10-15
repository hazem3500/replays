import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateLargeBundle } from '../scripts/large-bundle.mjs';
import { pickEncoding } from '../src/server/compression.ts';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';

// Budgets are deliberately loose for shared CI runners; the sizes are the real guard.
describe('large replay performance budget', { timeout: 30_000 }, () => {
  const bundle = generateLargeBundle({ id: 'perf-large' });
  const raw = Buffer.byteLength(JSON.stringify(bundle));
  let origin = '';
  let store: ReplayStore;
  const server = createServer();

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-perf-'));
    store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    await store.save(bundle);
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'client'),
    });
    server.on('request', (request, response) => void handle(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    origin = `http://127.0.0.1:${address.port}/api/replays`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('generates a ~20 MB, 50k-event, 5k-request bundle', () => {
    expect(bundle.events).toHaveLength(50_000);
    expect(bundle.network).toHaveLength(5_000);
    expect(raw).toBeGreaterThan(18 * 1024 * 1024);
  });

  it('serves the bundle compressed to under 20% of its size', async () => {
    for (const encoding of ['br', 'gzip'] as const) {
      const started = performance.now();
      const response = await fetch(`${origin}/perf-large`, { headers: { 'accept-encoding': encoding } });
      const wire = Number(response.headers.get('content-length'));
      await response.arrayBuffer();
      const elapsed = performance.now() - started;
      expect(response.headers.get('content-encoding')).toBe(encoding);
      expect(response.headers.get('vary')).toBe('Accept-Encoding');
      expect(wire).toBeLessThan(raw * 0.2);
      expect(elapsed).toBeLessThan(5_000);
    }
  });

  it('decodes to the stored bundle', async () => {
    // fetch transparently decodes the gzip body.
    const response = await fetch(`${origin}/perf-large`, { headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers.get('content-encoding')).toBe('gzip');
    const decoded = (await response.json()) as typeof bundle;
    expect(decoded.meta.id).toBe('perf-large');
    expect(decoded.events).toHaveLength(50_000);
  });

  it('answers revalidation with 304 and a cached copy quickly', async () => {
    const first = await fetch(`${origin}/perf-large`, { headers: { 'accept-encoding': 'br' } });
    await first.arrayBuffer();
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/".+"$/);

    let started = performance.now();
    const cached = await fetch(`${origin}/perf-large`, { headers: { 'accept-encoding': 'br' } });
    await cached.arrayBuffer();
    expect(performance.now() - started).toBeLessThan(1_000);

    started = performance.now();
    const revalidated = await fetch(`${origin}/perf-large`, { headers: { 'if-none-match': etag!, 'accept-encoding': 'br' } });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('lists from the sidecar without parsing the 20 MB bundle', async () => {
    const started = performance.now();
    const list = await store.list();
    expect(list).toMatchObject([{ id: 'perf-large', steps: 40 }]);
    expect(list[0]!.failedRequests).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('content negotiation', () => {
  it('prefers br, honours q-values and falls back to identity', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0.5, gzip;q=0.9')).toBe('gzip');
    expect(pickEncoding('*')).toBe('br');
    expect(pickEncoding('identity')).toBeUndefined();
    expect(pickEncoding(undefined)).toBeUndefined();
  });
});
