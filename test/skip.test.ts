import { describe, expect, it } from 'vitest';

import { idleGaps, INACTIVE_LEAD_MS, INACTIVE_THRESHOLD_MS } from '../src/shared/skip.ts';

const at = (timestamp: number, source?: number) => ({
  type: source === undefined ? 2 : 3,
  timestamp,
  data: source === undefined ? {} : { source },
});

describe('idleGaps', () => {
  it('finds stretches without interaction longer than the threshold, trimmed at both ends', () => {
    const events = [at(1000), at(1500, 2), at(2000, 0), at(8500, 2), at(9000)];
    expect(idleGaps(events)).toEqual([{ from: 500 + INACTIVE_LEAD_MS, to: 7500 - INACTIVE_LEAD_MS }]);
  });

  it('ignores DOM mutations (source 0) and short pauses', () => {
    const events = [
      at(0),
      at(500, 1),
      at(500 + INACTIVE_THRESHOLD_MS, 2),
      at(1000 + INACTIVE_THRESHOLD_MS, 0),
      at(1500 + INACTIVE_THRESHOLD_MS, 5),
    ];
    expect(idleGaps(events)).toEqual([]);
  });

  it('counts the tail after the last interaction', () => {
    expect(idleGaps([at(0, 2), at(5000)])).toEqual([{ from: INACTIVE_LEAD_MS, to: 5000 - INACTIVE_LEAD_MS }]);
  });
});

it('leaves capture beats and short waits alone, with 800ms lead around real stalls', () => {
  expect(INACTIVE_THRESHOLD_MS).toBe(4000);
  expect(INACTIVE_LEAD_MS).toBe(800);
  expect(idleGaps([at(0, 2), at(1200, 2), at(4000, 2), at(8000, 2)])).toEqual([]);
  expect(idleGaps([at(0, 2), at(4001, 2)])).toEqual([{ from: 800, to: 3201 }]);
});
