import { describe, expect, it } from 'vitest';

import { applyEdits, editTimeline } from '../src/shared/edits.ts';
import { buildWaterfall, visibleSegments } from '../src/client/viewer/waterfall.ts';
import { request, waterfallFixture, waterfallEdits as edits } from './waterfall-fixture.ts';

describe('waterfall source spans on the player clock', () => {
  it('positions overlapping requests independently on one clock, without inventing parents', () => {
    const bundle = waterfallFixture();
    bundle.network = [request(), request({ id: 'other', at: 2000, duration: 4000 })];
    const rows = buildWaterfall(bundle).rows.filter((row) => row.kind === 'network');
    expect(rows.map((row) => row.segments)).toEqual([[{ from: 1000, to: 3000 }], [{ from: 2000, to: 6000 }]]);
    expect(rows[0]!.segments[0]!.to).toBeGreaterThan(rows[1]!.segments[0]!.from);
    expect(rows[0]).not.toHaveProperty('parent');
  });

  it('clips trim-crossing spans, splits cuts, maps speed-up endpoints and preserves measured time', () => {
    const bundle = waterfallFixture();
    bundle.network = [
      request({ at: 500, duration: 8000 }),
      request({ id: 'cut-start', at: 3500, duration: 1000 }),
      request({ id: 'end', at: 8500, duration: 2000 }),
    ];
    const before = structuredClone(bundle);
    const timeline = editTimeline(edits, 10000);
    expect(timeline.duration).toBe(5000);
    const rows = buildWaterfall(bundle, timeline).rows.filter((row) => row.kind === 'network');
    expect(rows[0]).toMatchObject({
      at: 0,
      sourceAt: 500,
      measured: 8000,
      visible: 4500,
      segments: [
        { from: 0, to: 2000 },
        { from: 2000, to: 4500 },
      ],
    });
    expect(rows[1]).toMatchObject({ at: 2000, measured: 1000, visible: 250, segments: [{ from: 2000, to: 2250 }] });
    expect(rows[2]).toMatchObject({ at: 4500, measured: 2000, visible: 500, segments: [{ from: 4500, to: 5000 }] });
    expect(rows[0]).toMatchObject({ measured: 8000 });
    expect(bundle).toEqual(before);
    // Source data is required: the existing list intentionally omits rows whose start was removed.
    expect(applyEdits(bundle, edits).bundle.network.map((entry) => entry.id)).not.toContain('cut-start');
  });

  it('omits fully removed spans and removed action/paint points, including the exclusive trim end', () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ at: 3100, duration: 400 }), request({ id: 'trimmed', at: 9200, duration: 400 })];
    bundle.steps = [
      { at: 3500, kind: 'click', label: 'Cut action' },
      { at: 9000, kind: 'click', label: 'Trim end' },
    ];
    bundle.performance = { supported: ['paint'], entries: [{ at: 3500, kind: 'first-contentful-paint', value: 700 }] };
    expect(buildWaterfall(bundle, editTimeline(edits, 10000)).rows).toEqual([]);
  });

  it('treats actions and paint values as points, and measured tasks/interactions as spans', () => {
    const bundle = waterfallFixture();
    bundle.performance = {
      supported: ['paint', 'longtask', 'event'],
      entries: [
        { at: 2000, kind: 'first-contentful-paint', value: 20000 },
        { at: 2500, kind: 'largest-contentful-paint', value: 25000 },
        { at: 4500, kind: 'long-task', value: 1000 },
        { at: 6000, kind: 'slow-interaction', value: 400, eventType: 'click' },
      ],
    };
    const rows = buildWaterfall(bundle, editTimeline(edits, 10000)).rows;
    expect(
      rows
        .filter((row) => row.kind === 'action' || row.timing === 'point')
        .every((row) => !row.segments.length && row.measured === undefined),
    ).toBe(true);
    const task = rows.find((row) => row.kind === 'performance' && row.entry.kind === 'long-task');
    expect(task).toMatchObject({ at: 2250, measured: 1000, visible: 500, segments: [{ from: 2250, to: 2750 }] });
    expect(rows.find((row) => row.label === 'First contentful paint')).toMatchObject({ timing: 'point', segments: [] });
  });

  it('marks invalid and incomplete durations explicitly, preserving legitimate zero durations and failures', () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = [
      request({ duration: -1 }),
      request({ duration: NaN }),
      request({ duration: Infinity }),
      request({ duration: undefined as unknown as number }),
      request({ duration: 0 }),
      request({ status: 0, statusText: '', duration: 9000 }),
      request({ status: 0, statusText: 'net::ERR_FAILED', duration: 250 }),
      request({ status: 503 }),
    ];
    const rows = buildWaterfall(bundle).rows;
    expect(rows.filter((row) => row.timing === 'invalid')).toHaveLength(4);
    expect(rows.filter((row) => row.timing === 'invalid').every((row) => row.segments.length === 0)).toBe(true);
    expect(rows.find((row) => row.timing === 'incomplete')).toMatchObject({
      failed: false,
      slow: false,
      segments: [],
    });
    expect(rows.find((row) => row.timing === 'incomplete')?.measured).toBeUndefined();
    expect(rows.find((row) => row.measured === 0)).toMatchObject({ timing: 'measured', visible: 0, segments: [] });
    expect(rows.filter((row) => row.failed)).toHaveLength(2);
  });

  it('handles empty/legacy bundles, invalid timestamps and spans outside the recording', () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    expect(buildWaterfall(bundle).rows).toEqual([]);
    bundle.network = [request({ at: NaN }), request({ at: -20 }), request({ at: 12000 }), request({ at: 9990, duration: 1000 })];
    const model = buildWaterfall(bundle);
    expect(model.invalidTimes).toBe(2);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({ measured: 1000, visible: 10, segments: [{ from: 9990, to: 10000 }] });
    expect(visibleSegments(1, Infinity, editTimeline(undefined, 0))).toEqual([]);
    expect(visibleSegments(0, 100, editTimeline(undefined, 0))).toEqual([]);
  });
});
