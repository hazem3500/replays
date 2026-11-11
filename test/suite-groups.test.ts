import { describe, expect, it } from 'vitest';

import { assertReviewSuite, measureMsOf } from '../src/shared/review-suite.ts';
import {
  displayOrder,
  formatMs,
  formatPercent,
  groupPeers,
  groupRuns,
  isGrouped,
  median,
  percentChange,
  runHeadline,
  typicalSample,
} from '../src/shared/suite-groups.ts';

interface Row {
  sequence: number;
  replayId?: string;
  group?: string;
  target?: string;
  measure?: string;
  measureMs?: number;
}

const row = (sequence: number, group: string | undefined, target: string | undefined, measureMs?: number): Row => ({
  sequence,
  replayId: `r${sequence}`,
  ...(group ? { group } : {}),
  ...(target ? { target } : {}),
  ...(measureMs === undefined ? {} : { measure: 'Entries visible', measureMs }),
});

const runs: Row[] = [
  row(1, 'Cold open', '#6879', 1900),
  row(2, 'Cold open', '#6879', 2000),
  row(3, 'Cold open', '#6879', 2100),
  row(4, 'Cold open', 'main', 2600),
  row(5, 'Cold open', 'main', 2800),
  row(6, 'Warm open', '#6879', 900),
  row(7, 'Warm open', 'main', 1000),
  row(8, undefined, undefined),
];

describe('median and change', () => {
  it('takes the middle value, averaging an even count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('formats times and percentages', () => {
    expect(formatMs(840)).toBe('840 ms');
    expect(formatMs(2000)).toBe('2.0 s');
    expect(percentChange(2000, 2600)).toBe(-23);
    expect(percentChange(5, 0)).toBeUndefined();
    expect(formatPercent(-23)).toBe('−23%');
    expect(formatPercent(8)).toBe('+8%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('grouping', () => {
  const grouped = groupRuns(runs, 'main');

  it('lists groups in plan order with the baseline target first', () => {
    expect(grouped.groups.map((group) => group.name)).toEqual(['Cold open', 'Warm open']);
    expect(grouped.groups[0]?.targets.map((entry) => entry.target)).toEqual(['main', '#6879']);
    expect(grouped.other.map((run) => run.sequence)).toEqual([8]);
  });

  it('gives each target its median and change from the baseline', () => {
    const [base, other] = grouped.groups[0]?.targets ?? [];
    expect(base).toMatchObject({ baseline: true, median: 2700 });
    expect(base?.delta).toBeUndefined();
    expect(other).toMatchObject({ median: 2000, delta: -26 });
    expect(other?.samples).toHaveLength(3);
  });

  it('orders the display and detects grouped suites', () => {
    expect(displayOrder(grouped).map((run) => run.sequence)).toEqual([4, 5, 1, 2, 3, 7, 6, 8]);
    expect(isGrouped(runs)).toBe(true);
    expect(isGrouped([row(1, undefined, undefined)])).toBe(false);
  });

  it('picks the median sample as the typical one', () => {
    const entry = grouped.groups[0]?.targets[1];
    expect(entry && typicalSample(entry)?.sequence).toBe(2);
  });
});

describe('peers', () => {
  it('offers only other targets of the same group, baseline first', () => {
    const selected = runs[0];
    const peers = selected ? groupPeers(runs, selected, 'main') : [];
    expect(peers.map((peer) => [peer.target, peer.baseline, peer.run.group])).toEqual([['main', true, 'Cold open']]);
  });

  it('offers none to an ungrouped run', () => {
    const selected = runs[7];
    expect(selected && groupPeers(runs, selected, 'main')).toEqual([]);
  });
});

describe('headline', () => {
  it('names the step, the median and the baseline change', () => {
    const selected = runs[0];
    const line = selected ? runHeadline(runs, selected, 'main') : undefined;
    expect(line?.lead).toBe('Cold open on #6879: Entries visible after 1.9 s');
    expect(line?.median).toBe('median of 3: 2.0 s');
    expect(line?.baseline?.text).toBe('main 2.7 s (−26%)');
  });

  it('is absent without a measured time', () => {
    const selected = runs[7];
    expect(selected && runHeadline(runs, selected, 'main')).toBeUndefined();
  });
});

describe('measureMsOf', () => {
  const bundle = {
    meta: { duration: 5000 },
    steps: [
      { at: 100, label: 'Open' },
      { at: 1500, label: 'Entries visible' },
    ],
  };

  it('ends a step where the next begins, or before the closing wait', () => {
    expect(measureMsOf(bundle, 'Open')).toBe(1500);
    expect(measureMsOf(bundle, 'Entries visible')).toBe(4100);
    expect(measureMsOf(bundle, 'Missing')).toBeUndefined();
  });
});

const suite = (run: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  id: 'perf',
  title: 'Perf',
  createdAt: '2026-11-10T10:00:00.000Z',
  runs: [{ id: 'a', sequence: 1, label: 'A', status: 'passed', startedAt: '2026-11-10T10:00:00.000Z', ...run }],
  ...extra,
});

describe('suite registration', () => {
  it('accepts grouping fields and a baseline', () => {
    expect(() =>
      assertReviewSuite(suite({ group: 'Cold open', target: 'main', measure: 'Open', measureMs: 12 }, { baseline: 'main' })),
    ).not.toThrow();
  });

  it('rejects bad values', () => {
    expect(() => assertReviewSuite(suite({ group: '' }))).toThrow('group');
    expect(() => assertReviewSuite(suite({ target: 'x'.repeat(41) }))).toThrow('target');
    expect(() => assertReviewSuite(suite({ measureMs: -1 }))).toThrow('measureMs');
  });
});
