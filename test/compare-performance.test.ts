import { describe, expect, it } from 'vitest';

import { deltaLabel, metricDelta, metricValues } from '../src/client/compare/performance-compare.ts';
import type { ReplayBundle, ReplayPerformanceEntry } from '../src/shared/replay.ts';

const bundle = (entries: ReplayPerformanceEntry[]) => ({ performance: { supported: [], entries } }) as unknown as ReplayBundle;

describe('performance across compared recordings', () => {
  it('takes the last paint candidate and the worst task and interaction', () => {
    const values = metricValues(
      bundle([
        { at: 500, kind: 'first-contentful-paint', value: 500 },
        { at: 900, kind: 'largest-contentful-paint', value: 900 },
        { at: 1500, kind: 'largest-contentful-paint', value: 1500 },
        { at: 2000, kind: 'long-task', value: 120 },
        { at: 2500, kind: 'long-task', value: 80 },
        { at: 3000, kind: 'slow-interaction', value: 240, eventType: 'click' },
      ]),
    );
    expect(values).toEqual({ fcp: 500, lcp: 1500, 'long-task': 120, interaction: 240 });
  });

  it('reports a metric the recording never captured as missing, not as zero', () => {
    expect(metricValues(bundle([])).lcp).toBeUndefined();
    expect(metricDelta(undefined, 900)).toBeUndefined();
  });

  it('calls a slower value slower, a faster one faster and a tiny difference the same', () => {
    expect(metricDelta(2900, 880)).toEqual({ difference: 2020, tone: 'slower' });
    expect(metricDelta(62, 310)?.tone).toBe('faster');
    expect(metricDelta(905, 890)?.tone).toBe('same');
  });

  it('labels a difference with its direction and unit', () => {
    expect(deltaLabel({ difference: 2020, tone: 'slower' })).toBe('+2.02 s');
    expect(deltaLabel({ difference: -248, tone: 'faster' })).toBe('−248 ms');
    expect(deltaLabel({ difference: 5, tone: 'same' })).toBe('Same');
  });
});
