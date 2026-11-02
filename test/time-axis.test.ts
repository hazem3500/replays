import { describe, expect, it } from 'vitest';

import { clampDomain, replayDomain, spanPercent, tickLabel, tickStep, timeScale } from '../src/client/viewer/time-axis.ts';

describe('time axis', () => {
  it('maps the replay domain onto a width and back', () => {
    const scale = timeScale(replayDomain(10_000), 500);
    expect(scale.x(4000)).toBe(200);
    expect(scale.ms(200)).toBe(4000);
    // The same 40 % as the scrubber, whatever the width.
    expect(timeScale(replayDomain(10_000), 100).x(4000)).toBe(40);
  });

  it('never divides by zero', () => {
    expect(replayDomain(0)).toEqual({ from: 0, to: 1 });
    expect(replayDomain(Number.NaN)).toEqual({ from: 0, to: 1 });
    expect(Number.isFinite(timeScale({ from: 5, to: 5 }, 100).x(5))).toBe(true);
  });

  it('puts ticks on round steps inside the domain', () => {
    const ticks = timeScale(replayDomain(11_100), 600).ticks(6);
    expect(ticks.map((tick) => tick.ms)).toEqual([0, 2000, 4000, 6000, 8000, 10_000]);
    expect(ticks.map((tick) => tick.label)).toEqual(['0:00', '0:02', '0:04', '0:06', '0:08', '0:10']);
    expect(ticks[1]!.x).toBeCloseTo((2000 / 11_100) * 600);
  });

  it('labels sub-second steps with tenths', () => {
    const ticks = timeScale({ from: 3000, to: 5500 }, 400).ticks(5);
    expect(ticks[0]).toMatchObject({ ms: 3000, x: 0, label: '0:03.0' });
    expect(ticks.map((tick) => tick.label)).toContain('0:03.5');
    expect(tickStep(2500, 5)).toBe(500);
    expect(tickLabel(65_000, 1000)).toBe('1:05');
    expect(tickLabel(2500, 2500)).toBe('0:02.5');
  });

  it('clamps zoom domains to the replay and a minimum span', () => {
    expect(clampDomain({ from: 5500, to: 3000 }, { from: 0, to: 10_000 })).toEqual({ from: 3000, to: 5500 });
    expect(clampDomain({ from: -50, to: 20_000 }, { from: 0, to: 10_000 })).toEqual({ from: 0, to: 10_000 });
    expect(clampDomain({ from: 1000, to: 1010 }, { from: 0, to: 10_000 }, 50)).toEqual({ from: 980, to: 1030 });
  });

  it('gives spans in percent, clipped to the zoomed domain', () => {
    const scale = timeScale({ from: 1000, to: 3000 }, 100);
    expect(spanPercent(scale, 1500, 2000)).toEqual({ left: 25, width: 25, clipped: false });
    expect(spanPercent(scale, 0, 2000)).toEqual({ left: 0, width: 50, clipped: true });
  });
});
