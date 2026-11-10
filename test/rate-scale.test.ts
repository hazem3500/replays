import { describe, expect, it } from 'vitest';

import { SPEED_RATES } from '../src/shared/effects.ts';
import { jumpRate, RATE_LAST_INDEX, RATE_STEPS, rateAt, rateIndex, previewSpeed, snapRate } from '../src/shared/rate-scale.ts';
import { PLAYBACK_SPEEDS } from '../src/shared/render-variant.ts';

describe('rate scale', () => {
  it('steps 0.25 below 4, 0.5 up to 8 and 1 above, from 1 to 16', () => {
    expect(RATE_STEPS.slice(0, 5)).toEqual([1, 1.25, 1.5, 1.75, 2]);
    expect(RATE_STEPS).toContain(3.75);
    expect(RATE_STEPS).not.toContain(4.25);
    expect(RATE_STEPS.slice(RATE_STEPS.indexOf(4), RATE_STEPS.indexOf(4) + 3)).toEqual([4, 4.5, 5]);
    expect(RATE_STEPS.slice(RATE_STEPS.indexOf(8))).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(RATE_STEPS).toHaveLength(RATE_LAST_INDEX + 1);
  });

  it('puts every preset on a step, and maps index and rate back and forth', () => {
    for (const preset of SPEED_RATES) expect(rateAt(rateIndex(preset))).toBe(preset);
    expect(rateAt(-3)).toBe(1);
    expect(rateAt(99)).toBe(16);
  });

  it('reads an off-scale rate as its nearest step', () => {
    expect(snapRate(2.6)).toBe(2.5);
    expect(snapRate(5.2)).toBe(5);
    expect(snapRate(0.2)).toBe(1);
    expect(snapRate(40)).toBe(16);
  });

  it('jumps between the presets and the ends', () => {
    expect(jumpRate(1, 1)).toBe(1.5);
    expect(jumpRate(1.75, 1)).toBe(2);
    expect(jumpRate(2, -1)).toBe(1.5);
    expect(jumpRate(5, 1)).toBe(8);
    expect(jumpRate(8, 1)).toBe(16);
    expect(jumpRate(16, 1)).toBe(16);
    expect(jumpRate(1, -1)).toBe(1);
  });

  it('previews at the fastest player speed not above the rate', () => {
    expect(previewSpeed(1)).toBe(1);
    expect(previewSpeed(3.5)).toBe(2);
    expect(previewSpeed(16)).toBe(8);
    expect(PLAYBACK_SPEEDS).toContain(previewSpeed(2.5));
  });
});
