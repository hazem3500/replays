import { describe, expect, it } from 'vitest';

import { keyedTime, KEY_STEP_MS, ribbonTimeAt } from '../src/client/hooks/use-ribbon-scrub.ts';

describe('ribbon playhead scrub', () => {
  it('maps x to time and clamps to the strip', () => {
    expect(ribbonTimeAt(150, 100, 200, 10_000)).toBe(2500);
    expect(ribbonTimeAt(0, 100, 200, 10_000)).toBe(0);
    expect(ribbonTimeAt(900, 100, 200, 10_000)).toBe(10_000);
  });

  it('steps with the arrows and clamps', () => {
    expect(keyedTime('ArrowRight', 500, 10_000)).toBe(500 + KEY_STEP_MS);
    expect(keyedTime('ArrowLeft', 500, 10_000)).toBe(0);
    expect(keyedTime('ArrowRight', 9_800, 10_000)).toBe(10_000);
    expect(keyedTime('a', 0, 10)).toBeUndefined();
  });
});
