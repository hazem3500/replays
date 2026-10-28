import { describe, expect, it } from 'vitest';

import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import {
  buildMoments,
  buildVitals,
  causeOf,
  causeText,
  orderMoments,
  performanceBadge,
  vitalDeltas,
} from '../src/client/viewer/performance/model.ts';
import { performanceFixture } from './performance-fixture.ts';
import { request } from './waterfall-fixture.ts';

function shop() {
  const bundle = performanceFixture();
  bundle.performance!.entries = [
    { at: 196, kind: 'first-contentful-paint', value: 196 },
    { at: 3737, kind: 'slow-interaction', value: 72, eventType: 'pointerdown' },
    { at: 3739, kind: 'slow-interaction', value: 72, eventType: 'pointerup' },
    { at: 3739, kind: 'slow-interaction', value: 72, eventType: 'click' },
    { at: 5570, kind: 'slow-interaction', value: 56, eventType: 'beforeinput' },
    { at: 5571, kind: 'slow-interaction', value: 56, eventType: 'input' },
    { at: 8626, kind: 'slow-interaction', value: 608, eventType: 'pointerdown' },
    { at: 8626, kind: 'slow-interaction', value: 608, eventType: 'click' },
    { at: 8627, kind: 'long-task', value: 182 },
    { at: 400, kind: 'long-task', value: 310 },
  ];
  return bundle;
}

const momentsOf = (bundle = shop()) => buildMoments(buildPerformance(bundle).signals);

describe('performance moments', () => {
  it('folds the pointer, click and input events of one interaction into one moment', () => {
    expect(momentsOf().map((item) => `${item.label} ${item.value}`)).toEqual([
      'Long task 310',
      'Click 72',
      'Typing 56',
      'Click 608',
      'Long task 182',
    ]);
  });

  it('keeps two interactions apart when their durations differ', () => {
    const bundle = shop();
    bundle.performance!.entries = [
      { at: 1000, kind: 'slow-interaction', value: 80, eventType: 'keydown' },
      { at: 1010, kind: 'slow-interaction', value: 120, eventType: 'keydown' },
    ];
    expect(momentsOf(bundle)).toHaveLength(2);
  });

  it('lists the worst first: poor before needs work, then the furthest over its line', () => {
    expect(orderMoments(momentsOf(), 'worst').map((item) => `${item.label} ${item.verdict}`)).toEqual([
      'Long task poor',
      'Click poor',
      'Long task needs-work',
      'Click good',
      'Typing good',
    ]);
  });

  it('blames an overlapping long task for a slow interaction', () => {
    const moments = momentsOf();
    const click = moments.find((item) => item.value === 608)!;
    expect(causeText(causeOf(click, moments, []))).toBe('a 182 ms long task blocked the page');
  });

  it('points at requests in flight when no task overlapped, and at page code when nothing did', () => {
    const bundle = shop();
    bundle.network = [request({ id: 'cart', at: 3700, duration: 120 })];
    const moments = momentsOf(bundle);
    const rows = buildNetworkRows(bundle);
    expect(
      causeText(
        causeOf(
          moments.find((item) => item.value === 72)!,
          moments,
          rows,
        ),
      ),
    ).toBe('1 request in flight');
    expect(
      causeText(
        causeOf(
          moments.find((item) => item.value === 56)!,
          moments,
          rows,
        ),
      ),
    ).toBe('no request in flight: page code ran long');
  });

  it('badges the tab with the moments over budget, in danger ink when one is poor', () => {
    expect(performanceBadge(momentsOf())).toEqual({ value: 3, tone: 'danger', label: '3 slow moments' });
  });
});

function vitalsOf(bundle = shop()) {
  const signals = buildPerformance(bundle).signals;
  return Object.fromEntries(buildVitals(signals, buildMoments(signals), bundle.performance).map((vital) => [vital.id, vital]));
}

describe('performance vitals', () => {
  it('judges what was captured and sums blocking time past 50 ms', () => {
    const vitals = vitalsOf();
    expect(vitals.fcp).toMatchObject({ value: 196, verdict: 'good' });
    expect(vitals.interaction).toMatchObject({ value: 608, verdict: 'poor' });
    expect(vitals.task).toMatchObject({ value: 310, verdict: 'poor' });
    expect(vitals.tbt).toMatchObject({ value: 260 + 132 });
  });

  it('says not captured for an unsupported observer and none for a watched one, never 0', () => {
    const bundle = shop();
    bundle.performance = { supported: ['paint'], entries: [] };
    const vitals = vitalsOf(bundle);
    expect(vitals.fcp).toEqual({ id: 'fcp', missing: 'none' });
    expect(vitals.lcp).toEqual({ id: 'lcp', missing: 'not-captured' });
    expect(vitals.tbt).toEqual({ id: 'tbt', missing: 'not-captured' });
  });

  it('takes the latest largest-paint candidate, not the largest value', () => {
    const bundle = shop();
    bundle.performance!.entries.push(
      { at: 900, kind: 'largest-contentful-paint', value: 2600 },
      { at: 1400, kind: 'largest-contentful-paint', value: 1400 },
    );
    expect(vitalsOf(bundle).lcp).toMatchObject({ value: 1400, at: 1400 });
  });

  it('gives each vital’s difference from another recording, skipping ones either side lacks', () => {
    const mine = buildVitals(buildPerformance(shop()).signals, momentsOf(), shop().performance);
    const other = shop();
    other.performance!.entries = [{ at: 196, kind: 'first-contentful-paint', value: 250 }];
    const theirs = buildVitals(buildPerformance(other).signals, momentsOf(other), other.performance);
    expect(vitalDeltas(mine, theirs)).toEqual({ fcp: -54, tbt: 392 });
  });
});
