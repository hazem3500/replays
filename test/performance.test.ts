import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import {
  buildPerformance,
  chartLaneRows,
  focusPerformanceWindow,
  missingPerformanceLabel,
  overlaps,
  relatedPerformanceActivity,
} from '../src/client/viewer/performance.ts';
import { rowDuration } from '../src/client/viewer/waterfall.ts';
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
    expect(rowDuration(model.largestPaint!)).toBe('1.80 s from navigation');
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
    expect(relatedPerformanceActivity(model.longestTask!, model.rows).overlapping.map((row) => row.id)).toContain('network-0');
  });

  it('does not invent concurrency for spans made adjacent by a cut, or at exclusive endpoints', () => {
    const bundle = performanceFixture();
    bundle.network = [];
    bundle.steps = [];
    bundle.performance!.entries = [
      { at: 2500, kind: 'long-task', value: 500 },
      { at: 4000, kind: 'slow-interaction', value: 500 },
      { at: 4500, kind: 'first-contentful-paint', value: 4500 },
    ];
    const model = buildPerformance(bundle, editTimeline(waterfallEdits, 10000));
    expect(model.signals[0]!.segments.at(-1)?.to).toBe(model.signals[1]!.at);
    expect(overlaps(model.signals[0]!, model.signals[1]!)).toBe(false);
    expect(overlaps(model.signals[1]!, model.signals[2]!)).toBe(false);
    expect(relatedPerformanceActivity(model.signals[0]!, model.rows).overlapping).toEqual([]);
  });

  it('separates observed overlap from nearby actions using source time and includes points inside spans', () => {
    const bundle = performanceFixture();
    bundle.steps.push({ at: 2200, kind: 'click', label: 'Boundary' }, { at: 2201, kind: 'click', label: 'Outside' });
    const model = buildPerformance(bundle),
      activity = relatedPerformanceActivity(model.longestTask!, model.rows);
    expect(activity.overlapping.map((row) => row.id)).toEqual(['network-0', 'performance-2', 'action-1']);
    expect(activity.nearbyActions.map((row) => row.label)).toEqual(['click: Open projects', 'click: Boundary']);
    const paintActivity = relatedPerformanceActivity(model.largestPaint!, model.rows);
    expect(paintActivity.overlapping.map((row) => row.id)).toEqual(['network-0']);
  });

  it('never interprets an incomplete request duration as a span or attributes CPU cost to it', () => {
    const bundle = performanceFixture();
    bundle.network = [request({ at: 1800, status: 0, statusText: '', duration: 9999 })];
    const model = buildPerformance(bundle),
      row = model.rows.find((candidate) => candidate.kind === 'network')!;
    expect(row).toMatchObject({ timing: 'incomplete', segments: [] });
    expect(row.measured).toBeUndefined();
    expect(overlaps(model.longestTask!, row)).toBe(true); // Only its start is observed during the task.
    expect(overlaps(model.largestPaint!, row)).toBe(false);
    expect(rowDuration(row)).toContain('duration unknown');
  });

  it('bounds large chart lanes, retains an off-cap selected event, and discloses exact omissions', () => {
    const bundle = performanceFixture();
    bundle.network = Array.from({ length: 1000 }, (_, index) => request({ id: String(index), at: index * 10, duration: 20 }));
    const model = buildPerformance(bundle),
      lane = chartLaneRows(model.rows, 'network', { from: 0, to: 10000 }, 'network-999');
    expect(lane.rows).toHaveLength(160);
    expect(lane.omitted).toBe(840);
    expect(lane.rows.some((row) => row.id === 'network-999')).toBe(true);
    const zoomed = chartLaneRows(model.rows, 'network', { from: 500, to: 600 });
    expect(zoomed.rows).toHaveLength(11);
    expect(zoomed.rows.some((row) => row.id === 'network-49')).toBe(true);
    expect(zoomed.rows.some((row) => row.id === 'network-60')).toBe(false);
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

  it('keeps a legitimate zero value and clamps zoom to the visible recording', () => {
    const bundle = performanceFixture();
    bundle.performance!.entries = [
      { at: 0, kind: 'long-task', value: 0 },
      { at: 9990, kind: 'long-task', value: 1000 },
    ];
    const model = buildPerformance(bundle);
    expect(model.moments.find((row) => row.measured === 0)?.timing).toBe('measured');
    expect(focusPerformanceWindow(model.longestTask!, 10000)).toEqual({ from: 8990, to: 10000 });
    expect(focusPerformanceWindow(model.signals[0]!, 10000)).toEqual({ from: 0, to: 1000 });
    expect(focusPerformanceWindow(model.signals[0]!, 0)).toEqual({ from: 0, to: 0 });
  });
});
