import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import {
  buildVitals,
  byWorst,
  DEFAULT_BUDGETS,
  judgeSignal,
  severity,
  totalBlockingTime,
  verdictFor,
} from '../src/client/viewer/performance/budgets.ts';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { tabSummary } from '../src/client/viewer/tab-summary.ts';
import { performanceMarkers } from '../src/client/viewer/performance/scrubber-track.ts';
import { performanceFixture } from './performance-fixture.ts';
import { request } from './waterfall-fixture.ts';

describe('budgets and verdicts', () => {
  it('judges against [good, poor] inclusive of good, exclusive of poor', () => {
    expect(verdictFor(2500, DEFAULT_BUDGETS.lcp)).toBe('good');
    expect(verdictFor(2501, DEFAULT_BUDGETS.lcp)).toBe('needs-improvement');
    expect(verdictFor(4000, DEFAULT_BUDGETS.lcp)).toBe('needs-improvement');
    expect(verdictFor(4001, DEFAULT_BUDGETS.lcp)).toBe('poor');
    expect(verdictFor(50, DEFAULT_BUDGETS['long-task'])).toBe('good');
    expect(verdictFor(182, DEFAULT_BUDGETS['long-task'])).toBe('needs-improvement');
  });

  it('derives total blocking time from long tasks over 50 ms', () => {
    expect(totalBlockingTime([])).toBe(0);
    expect(totalBlockingTime([420, 90, 40])).toBe(370 + 40);
    expect(totalBlockingTime([Number.NaN, -1, 60])).toBe(10);
  });

  it('ranks worst first by distance past each budget’s poor line', () => {
    expect(severity(300, DEFAULT_BUDGETS['long-task'])).toBeCloseTo(1.2);
    const model = buildPerformance(performanceFixture());
    const judged = model.signals.flatMap((row) => judgeSignal(row) ?? []).toSorted(byWorst);
    expect(judged.map((item) => `${item.row.entry.kind}:${item.verdict}`)).toEqual([
      'long-task:poor',
      'slow-interaction:needs-improvement',
      'long-task:needs-improvement',
      'largest-contentful-paint:good',
      'first-contentful-paint:good',
    ]);
  });

  it('builds the vitals strip from what was captured', () => {
    const model = buildPerformance(performanceFixture());
    const vitals = Object.fromEntries(buildVitals(model.signals, model.track).map((vital) => [vital.id, vital]));
    expect(vitals.lcp).toMatchObject({ value: 2400, verdict: 'good' });
    expect(vitals.fcp).toMatchObject({ value: 1000, verdict: 'good' });
    expect(vitals.interaction).toMatchObject({ value: 310, verdict: 'needs-improvement' });
    expect(vitals['long-task']).toMatchObject({ value: 420, verdict: 'poor' });
    expect(vitals.tbt).toMatchObject({ value: 410, verdict: 'needs-improvement' });
  });

  it('says "Not captured" for unsupported observers, never 0', () => {
    const bundle = performanceFixture();
    bundle.performance = { supported: ['paint'], entries: [{ at: 1000, kind: 'first-contentful-paint', value: 900 }] };
    const model = buildPerformance(bundle);
    const vitals = Object.fromEntries(buildVitals(model.signals, model.track).map((vital) => [vital.id, vital]));
    expect(vitals.lcp).toEqual({ id: 'lcp', kind: 'largest-contentful-paint', missing: 'not-captured' });
    expect(vitals.tbt).toMatchObject({ missing: 'not-captured' });
    expect(vitals.tbt!.value).toBeUndefined();
    bundle.performance.supported.push('longtask');
    const supported = buildPerformance(bundle);
    const next = Object.fromEntries(buildVitals(supported.signals, supported.track).map((vital) => [vital.id, vital]));
    expect(next.tbt).toMatchObject({ value: 0, verdict: 'good' });
    expect(next['long-task']).toMatchObject({ missing: 'none' });
  });
});

describe('tab summary', () => {
  it('counts totals and problems per tab', () => {
    const bundle = performanceFixture();
    bundle.network.push(request({ id: 'bad', at: 2000, status: 422 }));
    bundle.console = [
      { at: 100, level: 'error', message: 'x' },
      { at: 200, level: 'warn', message: 'y' },
    ];
    expect(tabSummary(bundle, 'network')).toEqual({ total: 3, problems: 1, problemKind: 'failed', problemLabel: '1 failed' });
    expect(tabSummary(bundle, 'console')).toEqual({ total: 2, problems: 1, problemKind: 'error', problemLabel: '1 error' });
    expect(tabSummary(bundle, 'performance')).toEqual({ total: 5, problems: 1, problemKind: 'warning', problemLabel: '1 poor' });
  });

  it('skips entries wholly inside a cut', () => {
    const bundle = performanceFixture();
    bundle.network = [request({ id: 'cut', at: 3200, duration: 100, status: 500 }), request({ id: 'kept', at: 5000, duration: 100 })];
    const timeline = editTimeline({ version: 1, cuts: [{ id: 'c', from: 3000, to: 4000 }] }, 10_000);
    expect(tabSummary(bundle, 'network', timeline)).toMatchObject({ total: 1, problems: 0, problemLabel: '' });
  });
});

describe('scrubber performance ranges', () => {
  it('marks long tasks and over-budget interactions as toned ranges, once per press', () => {
    const markers = performanceMarkers({
      performance: {
        supported: ['longtask', 'event'],
        entries: [
          { at: 100, kind: 'slow-interaction', value: 72, eventType: 'click' },
          { at: 8626, kind: 'slow-interaction', value: 208, eventType: 'pointerdown' },
          { at: 8626.1, kind: 'slow-interaction', value: 208, eventType: 'click' },
          { at: 8626.5, kind: 'long-task', value: 182 },
          { at: 9000, kind: 'long-task', value: 300 },
          { at: 500, kind: 'first-contentful-paint', value: 500 },
        ],
      },
    });
    expect(markers.map(({ atMs, durationMs, tone, label }) => [atMs, durationMs, tone, label])).toEqual([
      [8626, 208, 'warn', 'Slow click · 208 ms · Needs work'],
      [8626.5, 182, 'warn', 'Long task · 182 ms · Needs work'],
      [9000, 300, 'error', 'Long task · 300 ms · Poor'],
    ]);
  });
});
