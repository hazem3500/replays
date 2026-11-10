import { describe, expect, it } from 'vitest';

import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { BUDGETS, buildMoments, buildVitals } from '../src/client/viewer/performance/model.ts';
import { cadenceStats, groupNote, shiftScore, shiftVerdict, vitalStat } from '../src/client/viewer/performance/stats.ts';
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

const memberIds = (mark: { items: readonly { id: string }[] }) => mark.items.map((member) => member.id);

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
    const marks = clusterMarks(items, 1000, 1000);
    expect(marks.map(memberIds)).toEqual([['a', 'b'], ['c']]);
    expect(marks[0]).toMatchObject({ at: 0, end: 20 });
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

const verdictOf = (bundle = recording()) => {
  const { moments, requests, vitals, model } = inputs(bundle);
  return { verdict: buildVerdict({ moments, vitals, frames: model.frames, shifts: model.shifts, requests }), moments, vitals };
};

describe('verdict line', () => {
  it('names the main problem and its cause, and jumps to it', () => {
    const { verdict, moments } = verdictOf();
    expect(verdict.headline).toBe('Slow at 0:08: a long task blocked a click');
    expect(verdict.tone).toBe('poor');
    expect(verdict.jump).toMatchObject({ label: 'Jump to 0:08', at: 8626 });
    expect(verdict.jump?.ids).toEqual([must(moments.find((moment) => moment.value === 608)).id]);
  });

  it('points at the same moment the Slowest interaction stat does, and repeats no figures', () => {
    const { verdict, vitals } = verdictOf();
    const slowest = must(vitals.find((vital) => vital.id === 'interaction'));
    expect(verdict.jump?.at).toBe(must(slowest.moment).at);
    expect(verdict.headline).not.toMatch(/\d+ ?ms/);
  });

  it('blames the long tasks when no interaction was slow', () => {
    const bundle = recording();
    must(bundle.performance).entries = must(bundle.performance).entries.filter((entry) => entry.kind === 'long-task');
    const { verdict } = verdictOf(bundle);
    expect(verdict.headline).toMatch(/^Slow (around 0:\d\d|while loading): 2 long tasks blocked the page$|^Slow at/);
    expect(verdict.jump?.ids.length).toBeGreaterThan(0);
  });

  it('says loading when the long tasks came before the largest paint or before any interaction', () => {
    const bundle = recording();
    must(bundle.performance).entries = [
      { at: 300, kind: 'long-task', value: 900 },
      { at: 900, kind: 'long-task', value: 700 },
    ];
    const { verdict } = verdictOf(bundle);
    expect(verdict.headline).toBe('Slow while loading: 2 long tasks blocked the page');
    expect(verdict.jump?.label).toMatch(/^Jump to 0:0\d$/);
  });

  it('says nothing was slow when nothing was', () => {
    const verdict = buildVerdict({ moments: [], vitals: [], frames: [], shifts: [], requests: [] });
    expect(verdict).toEqual({ tone: 'good', headline: 'No slowdowns found' });
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

  it('stands in one muted line for a group with nothing measured, with a reason when one is known', () => {
    expect(groupNote('smoothness', [])).toEqual({ text: 'Frame rate wasn’t recorded', reason: 'Frame timing was not recorded.' });
    const lcp = vitalStat({ id: 'lcp', missing: 'none' });
    expect(groupNote('loading', [lcp])).toEqual({ text: 'Recording started after the page loaded' });
    const notCaptured = vitalStat({ id: 'fcp', missing: 'not-captured' });
    expect(groupNote('loading', [notCaptured]).reason).toContain('Not captured');
  });

  it('uses the web-vitals thresholds for paints', () => {
    expect([BUDGETS.fcp, BUDGETS.lcp]).toEqual([
      [1800, 3000],
      [2500, 4000],
    ]);
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
