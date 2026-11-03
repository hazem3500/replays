import { describe, expect, it } from 'vitest';

import { buildNetworkRows, buildPerformance, buildWaterfall, collectErrors } from '../src/client/diagnostics.ts';
import { editTimeline } from '../src/shared/model.ts';
import { request, waterfallEdits, waterfallFixture } from './waterfall-fixture.ts';

describe('independent diagnostic consumer', () => {
  it('maps visible request spans while preserving captured duration and source data', () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ at: 500, duration: 8000 })];
    const original = structuredClone(bundle);
    const timeline = editTimeline(waterfallEdits, 10000);
    const network = buildNetworkRows(bundle, timeline);
    const waterfall = buildWaterfall(bundle, timeline);
    expect(network[0]).toMatchObject({ at: 0, end: 4500, measured: 8000 });
    expect(waterfall.rows.find((row) => row.kind === 'network')).toMatchObject({
      at: 0,
      sourceAt: 500,
      measured: 8000,
      visible: 4500,
    });
    expect(bundle).toEqual(original);
  });

  it('retains unavailable performance provenance instead of inventing healthy metrics', () => {
    const bundle = waterfallFixture();
    expect(buildPerformance(bundle)).toMatchObject({ track: undefined, moments: [], largestPaint: undefined });
    bundle.performance = { supported: [], entries: [] };
    expect(buildPerformance(bundle).track).toBe(bundle.performance);
  });

  it('combines captured console and request failures chronologically without exposing request headers', () => {
    const bundle = waterfallFixture();
    bundle.console = [{ at: 2000, level: 'error', message: 'Payment failed' }];
    bundle.network = [
      request({ at: 1000, status: 503, statusText: 'Unavailable', requestHeaders: [{ name: 'x-debug', value: 'private' }] }),
    ];
    const errors = collectErrors(bundle);
    expect(errors.map((error) => [error.at, error.kind])).toEqual([
      [1000, 'network'],
      [2000, 'console'],
    ]);
    expect(errors[0]).toMatchObject({ requestId: 'req' });
    expect(JSON.stringify(errors)).not.toContain('private');
  });
});
