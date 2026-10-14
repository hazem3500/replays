import { describe, expect, it } from 'vitest';

import { CompressionCache, compress } from '../src/server/compression.ts';

describe('compression cache', () => {
  it('compresses one payload once when two callers miss together', async () => {
    const body = Buffer.from('x'.repeat(4000));
    const compressed = await compress(body, 'gzip');
    const cache = new CompressionCache(compressed.byteLength);
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return body;
    };

    const [first, second] = await Promise.all([cache.get('same', 'gzip', load), cache.get('same', 'gzip', load)]);
    expect(loads).toBe(1);
    expect(first).toEqual(second);

    let otherLoads = 0;
    await cache.get('other', 'gzip', async () => {
      otherLoads += 1;
      return body;
    });
    await cache.get('other', 'gzip', async () => {
      otherLoads += 1;
      return body;
    });
    expect(otherLoads).toBe(1);
  });
});
