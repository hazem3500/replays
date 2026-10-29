import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import { buildPerformance, missingPerformanceLabel } from '../src/client/viewer/performance.ts';
import { performanceFixture } from './performance-fixture.ts';
import { request, waterfallEdits } from './waterfall-fixture.ts';

describe('performance diagnosis timing and evidence', () => {
  it('ranks captured durations without adding overlapping observations or changing source data', () => {
    const bundle = performanceFixture(),
      before = structuredClone(bundle);
    const model = buildPerformance(bundle);
    expect(model.longestTask?.measured).toBe(420);
    expect(model.slowestInteraction?.measured).toBe(310);
    expect(model.moments.map((row) => row.measured)).toEqual([420, 310, 90]);
    expect(model.largestPaint?.entry.value).toBe(2400);
    expect(model).not.toHaveProperty('score');
    expect(model).not.toHaveProperty('totalBlockingTime');
    expect(bundle).toEqual(before);
  });

  it('keeps paint timestamps as points and selects the latest valid candidate, not a made-up duration/score', () => {
    const bundle = performanceFixture();
    bundle.performance!.entries.push({ at: 3000, kind: 'largest-contentful-paint', value: 1800 });
    bundle.performance!.entries.push({ at: 3100, kind: 'largest-contentful-paint', value: NaN });
    const model = buildPerformance(bundle);
    expect(model.largestPaint).toMatchObject({ at: 3000, segments: [], timing: 'point' });
    expect(model.largestPaint?.measured).toBeUndefined();
    expect(model.moments.every((row) => row.entry.kind === 'long-task' || row.entry.kind === 'slow-interaction')).toBe(true);
  });

  it('preserves measured durations while mapping crossing spans through trim, cuts and speed changes', () => {
    const bundle = performanceFixture();
    bundle.network = [request({ at: 3500, duration: 1000 })];
    bundle.performance!.entries = [
      { at: 3500, kind: 'long-task', value: 1000 },
      { at: 4500, kind: 'slow-interaction', value: 1000 },
      { at: 3500, kind: 'largest-contentful-paint', value: 3500 },
      { at: 3100, kind: 'long-task', value: 400 },
    ];
    const model = buildPerformance(bundle, editTimeline(waterfallEdits, 10000));
    expect(model.signals).toHaveLength(2);
    expect(model.longestTask).toMatchObject({
      sourceAt: 3500,
      at: 2000,
      measured: 1000,
      visible: 250,
      segments: [{ from: 2000, to: 2250 }],
    });
    expect(model.slowestInteraction).toMatchObject({ at: 2250, measured: 1000, visible: 500 });
    expect(model.largestPaint).toBeUndefined();
  });

  it('distinguishes unavailable capture, empty observations, invalid values and edited-out signals', () => {
    const bundle = performanceFixture();
    delete bundle.performance;
    expect(missingPerformanceLabel(buildPerformance(bundle), 'longtask', 'long-task')).toBe('Not recorded');
    bundle.performance = { supported: [], entries: [] };
    expect(missingPerformanceLabel(buildPerformance(bundle), 'longtask', 'long-task')).toBe('API unavailable');
    bundle.performance.supported = ['longtask'];
    expect(missingPerformanceLabel(buildPerformance(bundle), 'longtask', 'long-task')).toBe('None captured');
    bundle.performance.entries = [{ at: 2000, kind: 'long-task', value: -1 }];
    expect(buildPerformance(bundle).longestTask).toBeUndefined();
    expect(missingPerformanceLabel(buildPerformance(bundle), 'longtask', 'long-task')).toBe('Invalid / unknown');
    bundle.performance.entries = [{ at: 3100, kind: 'long-task', value: 100 }];
    expect(missingPerformanceLabel(buildPerformance(bundle, editTimeline(waterfallEdits, 10000)), 'longtask', 'long-task')).toBe(
      'Not on this timeline',
    );
  });

  it('keeps a legitimate zero value as a measured duration', () => {
    const bundle = performanceFixture();
    bundle.performance!.entries = [
      { at: 0, kind: 'long-task', value: 0 },
      { at: 9990, kind: 'long-task', value: 1000 },
    ];
    const model = buildPerformance(bundle);
    expect(model.moments.find((row) => row.measured === 0)?.timing).toBe('measured');
  });
});
