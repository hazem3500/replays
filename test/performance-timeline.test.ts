import { describe, expect, it } from 'vitest';

import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { buildMoments, buildVitals } from '../src/client/viewer/performance/model.ts';
import { cadenceStats, shiftScore, shiftVerdict, vitalStat } from '../src/client/viewer/performance/stats.ts';
import { buildLanes, clockLabel, clusterMarks, type LaneItem, niceTicks } from '../src/client/viewer/performance/timeline-model.ts';
import { buildVerdict } from '../src/client/viewer/performance/verdict.ts';
import { must } from './must.ts';
import { performanceFixture } from './performance-fixture.ts';
import { request } from './waterfall-fixture.ts';

function recording() {
  const bundle = performanceFixture();
  const track = must(bundle.performance);
  track.supported = ['paint', 'largest-contentful-paint', 'longtask', 'event', 'layout-shift'];
  track.entries = [
    { at: 196, kind: 'first-contentful-paint', value: 196 },
    { at: 3739, kind: 'slow-interaction', value: 72, eventType: 'click' },
    { at: 8626, kind: 'slow-interaction', value: 608, eventType: 'click' },
    { at: 8627, kind: 'long-task', value: 182 },
    { at: 400, kind: 'long-task', value: 310 },
  ];
  track.layoutShifts = [
    { at: 2000, value: 0.12, hadRecentInput: false },
    { at: 3000, value: 0.2, hadRecentInput: true },
  ];
  bundle.network = [request({ id: 'slow', at: 1000, duration: 900 }), request({ id: 'fast', at: 1200, duration: 80 })];
  return bundle;
}

function inputs(bundle = recording()) {
  const model = buildPerformance(bundle);
  const moments = buildMoments(model.signals);
  const requests = buildNetworkRows(bundle);
  return { model, moments, requests, vitals: buildVitals(model.signals, moments, model.track) };
}

const item = (id: string, at: number, end: number, lane: LaneItem['lane'] = 'interaction'): LaneItem => ({
  id,
  lane,
  at,
  end,
  verdict: 'good',
  title: id,
  value: '1 ms',
});

describe('layout shifts', () => {
  it('scores only shifts nobody caused', () => {
    const { model } = inputs();
    expect(model.shifts.map((shift) => shift.hadRecentInput)).toEqual([false, true]);
    expect(shiftScore(model.shifts)).toBeCloseTo(0.12);
  });

  it('rates the score at the Web Vitals lines', () => {
    expect([0.1, 0.1001, 0.25, 0.26].map(shiftVerdict)).toEqual(['good', 'needs-work', 'needs-work', 'poor']);
  });
});

describe('timeline lanes', () => {
  it('draws a lane only when it has data, slow requests only', () => {
    const { moments, requests, model } = inputs();
    expect(buildLanes(moments, requests, model.shifts).map((lane) => [lane.id, lane.items.length])).toEqual([
      ['interaction', 2],
      ['task', 2],
      ['request', 1],
      ['shift', 2],
    ]);
    expect(buildLanes([], [], [])).toEqual([]);
  });

  it('merges marks that touch once drawn, and keeps apart the ones that do not', () => {
    const items = [item('a', 0, 10), item('b', 11, 20), item('c', 500, 510)];
    // 1000 ms over 1000 px: a and b are 2 px apart, c is far off.
    const marks = clusterMarks(items, 1000, 1000);
    expect(marks.map((mark) => mark.items.map((member) => member.id))).toEqual([['a', 'b'], ['c']]);
    expect(marks[0]).toMatchObject({ at: 0, end: 20 });
    // Zoomed out the same items fall into one mark; zoomed in all three stay.
    expect(clusterMarks(items, 1000, 100)).toHaveLength(2);
    expect(clusterMarks(items, 1000, 10_000)).toHaveLength(3);
  });

  it('never draws a mark narrower than its minimum, so two instants a pixel apart are one mark', () => {
    expect(clusterMarks([item('a', 100, 100), item('b', 101, 101)], 1000, 1000)).toHaveLength(1);
  });

  it('takes the worst rating for a cluster', () => {
    const [mark] = clusterMarks([{ ...item('a', 0, 5), verdict: 'poor' }, item('b', 5, 9)], 1000, 1000);
    expect(mark?.verdict).toBe('poor');
  });
});

describe('time axis', () => {
  it('picks round positions and no more than asked', () => {
    expect(niceTicks(9000, 6)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(niceTicks(90_000, 6)).toEqual([0, 30_000, 60_000, 90_000]);
    expect(niceTicks(3_000, 6).at(-1)).toBeLessThanOrEqual(3000);
  });

  it('reads whole seconds', () => {
    expect([0, 14_900, 61_000].map(clockLabel)).toEqual(['0:00', '0:14', '1:01']);
  });
});

describe('verdict line', () => {
  it('names the slow click, what blocked it and where to seek', () => {
    const { moments, requests, vitals, model } = inputs();
    const verdict = buildVerdict({ moments, vitals, frames: model.frames, shifts: model.shifts, requests });
    const text = verdict.parts.map((sentence) => sentence.map((part) => part.text).join('')).join('. ');
    expect(text).toContain('A slow click at 0:08, blocked by a long task');
    expect(text).toContain('Layout shift score 0.12');
    expect(verdict.tone).toBe('poor');
    const [first] = verdict.parts[0] ?? [];
    expect(first).toMatchObject({ at: 8626, momentId: expect.any(String) });
  });

  it('says nothing was slow when nothing was', () => {
    const verdict = buildVerdict({ moments: [], vitals: [], frames: [], shifts: [], requests: [] });
    expect(verdict.tone).toBe('good');
    expect(verdict.parts).toEqual([[{ text: 'Nothing slow: no moment over budget' }]]);
  });
});

describe('stats', () => {
  it('splits a duration into its number and unit, and meters it at its real thresholds', () => {
    const { vitals } = inputs();
    const stat = vitalStat(must(vitals.find((vital) => vital.id === 'fcp')));
    expect([stat.value, stat.unit, stat.verdict]).toEqual(['196', 'ms', 'good']);
    expect(stat.meter?.bands.map((band) => band.verdict)).toEqual(['good', 'needs-work', 'poor']);
    const shares = stat.meter?.bands.reduce((sum, band) => sum + band.share, 0);
    expect(shares).toBeCloseTo(1);
  });

  it('gives a missing stat a reason instead of a number', () => {
    const stat = vitalStat({ id: 'lcp', missing: 'not-captured' });
    expect(stat.value).toBeUndefined();
    expect(stat.missing).toContain('Not captured');
  });

  it('folds the layout shift note into the shift stat when the browser cannot report it', () => {
    const bundle = recording();
    must(bundle.performance).supported = ['paint'];
    const { model } = inputs(bundle);
    const shift = cadenceStats(model.track, model.shifts).find((stat) => stat.id === 'shift');
    expect(shift?.value).toBeUndefined();
    expect(shift?.missing).toBe('Layout shift: not available in this browser.');
  });
});
