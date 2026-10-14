import { describe, expect, it } from 'vitest';

import { clampTime, clusterMarkers, countAtOrBefore, fitViewport, positionText, sortByAt } from '../src/client/timeline.ts';
import { formatClock } from '../src/shared/replay.ts';

describe('time formatting', () => {
  it('formats one clock style everywhere', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(2600)).toBe('0:02.6');
    expect(formatClock(61_050)).toBe('1:01.1');
    expect(formatClock(59_960)).toBe('1:00.0');
    expect(formatClock(-5)).toBe('0:00.0');
  });

  it('describes the scrubber position for assistive tech', () => {
    expect(positionText(2600, 3174)).toBe('0:02.6 of 0:03.2');
  });

  it('clamps seeks to the replay span', () => {
    expect(clampTime(-10, 1000)).toBe(0);
    expect(clampTime(1500, 1000)).toBe(1000);
    expect(clampTime(Number.NaN, 1000)).toBe(0);
  });
});

describe('fitViewport', () => {
  it('fits by width and centres vertically', () => {
    expect(fitViewport({ width: 720, height: 900 }, { width: 1440, height: 900 })).toEqual({ scale: 0.5, x: 0, y: 225 });
  });

  it('fits by height and centres horizontally, honouring padding', () => {
    const fit = fitViewport({ width: 1200, height: 470 }, { width: 1440, height: 900 }, 10);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.x).toBe(240);
    expect(fit.y).toBe(10);
  });

  it('returns a zero scale for empty boxes or viewports', () => {
    expect(fitViewport({ width: 0, height: 400 }, { width: 1440, height: 900 }).scale).toBe(0);
    expect(fitViewport({ width: 400, height: 400 }, { width: 0, height: 900 }).scale).toBe(0);
  });
});

describe('track windows', () => {
  it('counts entries at or before the playhead with a binary search', () => {
    const ats = [0, 0, 10, 20, 20, 30];
    expect(countAtOrBefore(ats, -1)).toBe(0);
    expect(countAtOrBefore(ats, 0)).toBe(2);
    expect(countAtOrBefore(ats, 19)).toBe(3);
    expect(countAtOrBefore(ats, 20)).toBe(5);
    expect(countAtOrBefore(ats, Number.POSITIVE_INFINITY)).toBe(6);
    expect(countAtOrBefore([], 5)).toBe(0);
  });

  it('sorts tracks by time without reordering ties', () => {
    const track = sortByAt([
      { at: 20, id: 'c' },
      { at: 5, id: 'a' },
      { at: 20, id: 'd' },
      { at: 5, id: 'b' },
    ]);
    expect(track.entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(track.ats).toEqual([5, 5, 20, 20]);
  });
});

describe('clusterMarkers', () => {
  it('merges markers closer than the minimum gap and keeps distant ones apart', () => {
    // 1000 ms on a 100 px track: 10 ms per px.
    expect(clusterMarkers([0, 50, 300, 1000], 1000, 100, 14)).toEqual([
      { at: 0, indices: [0, 1] },
      { at: 300, indices: [2] },
      { at: 1000, indices: [3] },
    ]);
  });

  it('measures the gap from the first marker of a cluster, so long runs split', () => {
    expect(clusterMarkers([0, 100, 200], 1000, 100, 14).map((cluster) => cluster.indices)).toEqual([[0, 1], [2]]);
  });

  it('never merges before the track has been measured', () => {
    expect(clusterMarkers([0, 0, 0], 1000, 0, 14)).toHaveLength(3);
  });
});
