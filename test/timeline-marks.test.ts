import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edit-timeline.ts';
import { activityBars, activityBinsFor, placeStepDots, removedSlices, stepDotLabel } from '../src/client/editor/timeline-marks.ts';

const START = 50_000;
const move = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 1, positions: [] } });
const click = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 2, type: 2, x: 1, y: 1 } });
const press = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 2, type: 1, x: 1, y: 1 } });
const typing = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 5, text: 'a' } });
const scroll = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 3, x: 0, y: 40 } });
const mutation = (at: number) => ({ type: 3, timestamp: START + at, data: { source: 0, adds: [] } });
const snapshot = { type: 2, timestamp: START, data: {} };
const step = (at: number, label = `Step at ${at}`, kind = 'click') => ({ at, label, kind });

describe('activityBars', () => {
  it('peaks in the slice of the recording each event happened in, counted from the first event', () => {
    const bars = activityBars([snapshot, move(100), move(9_950)], 10_000, 10);
    expect(bars.map((bar) => bar.level === 1)).toEqual([true, false, false, false, false, false, false, false, false, true]);
  });

  it('spreads a fading share of each event into the two slices either side and no further', () => {
    const levels = activityBars([snapshot, click(5_000)], 10_000, 11).map((bar) => bar.level);
    expect(levels[5]).toBe(1);
    expect([levels[4], levels[6]]).toEqual([levels[4], levels[4]]);
    expect(levels[3]).toBeGreaterThan(0);
    expect(levels[3]).toBeLessThan(levels[4] ?? 0);
    expect([levels[2], levels[8]]).toEqual([0, 0]);
  });

  it('lets one click outweigh a pointer move', () => {
    const bars = activityBars([snapshot, move(500), click(9_500)], 10_000, 10);
    expect(bars[9]?.level).toBe(1);
    expect(bars[0]?.level).toBeLessThan(0.5);
  });

  it('marks the slices where someone clicked or typed as strong, and only those', () => {
    const bars = activityBars([snapshot, move(100), scroll(1_100), typing(2_100), click(3_100)], 4_000, 4);
    expect(bars.map((bar) => bar.strong)).toEqual([false, false, true, true]);
  });

  it('counts a click once, not its press and release', () => {
    const lone = activityBars([snapshot, click(100), move(1_100)], 2_000, 2);
    const pressed = activityBars([snapshot, press(90), click(100), press(110), move(1_100)], 2_000, 2);
    expect(pressed).toEqual(lone);
  });

  it('keeps a quiet slice visible beside a very busy one', () => {
    const busy = Array.from({ length: 200 }, (_, index) => click(9_000 + index));
    const bars = activityBars([snapshot, move(100), ...busy], 10_000, 10);
    expect(bars[0]?.level).toBeGreaterThan(0.05);
  });

  it('uses one slice per twentieth of a second, within its fewest and finest', () => {
    expect([activityBinsFor(1_000), activityBinsFor(6_000), activityBinsFor(600_000)]).toEqual([60, 120, 160]);
  });

  it('ignores DOM changes and snapshots, and has nothing to draw without activity', () => {
    expect(activityBars([snapshot, mutation(100), mutation(900)], 1_000, 4)).toEqual([]);
  });
});

describe('removedSlices', () => {
  it('marks the slices a cut and a trim take out', () => {
    const timeline = editTimeline({ trim: { start: 1_000, end: 10_000 }, cuts: [{ from: 4_000, to: 6_000 }] }, 10_000);
    const removed = removedSlices(10, 10_000, (time) => timeline.isRemoved(time));
    expect(removed.flatMap((gone, index) => (gone ? [index] : []))).toEqual([0, 4, 5]);
  });
});

describe('placeStepDots', () => {
  it('places one dot per step in time order, each seeking to its own step', () => {
    const dots = placeStepDots([step(6_000, 'Pay'), step(1_000, 'Open')], 10_000, 1_000);
    expect(dots.map((dot) => [dot.at, dot.label, dot.index])).toEqual([
      [1_000, 'Open', 1],
      [6_000, 'Pay', 0],
    ]);
  });

  it('merges steps too close to tell apart into the first one', () => {
    const dots = placeStepDots([step(1_000, 'Type email'), step(1_050), step(1_100), step(5_000, 'Submit')], 10_000, 1_000, 12);
    expect(dots.map((dot) => [dot.at, dot.count])).toEqual([
      [1_000, 3],
      [5_000, 1],
    ]);
  });

  it('keeps steps apart once the ruler is wide enough to show them separately', () => {
    expect(placeStepDots([step(1_000), step(1_050)], 10_000, 4_000, 12)).toHaveLength(2);
  });

  it('names a merged dot by its action rather than a wait, and still seeks to its first step', () => {
    const [dot] = placeStepDots([step(1_000, 'Wait', 'wait'), step(1_010, 'Click Pay', 'click')], 10_000, 1_000);
    expect([dot?.kind, dot?.label, dot?.at]).toEqual(['click', 'Click Pay', 1_000]);
  });

  it('leaves out steps outside the recording and draws nothing on an unmeasured ruler', () => {
    expect(placeStepDots([step(-10), step(12_000)], 10_000, 1_000)).toEqual([]);
    expect(placeStepDots([step(1_000)], 10_000, 0)).toEqual([]);
  });
});

describe('stepDotLabel', () => {
  it('names a single step by its label and a merged dot by how many more it holds', () => {
    const [single] = placeStepDots([step(1_000, 'Open the cart')], 10_000, 1_000);
    const [merged] = placeStepDots([step(1_000, 'Open the cart'), step(1_001), step(1_002)], 10_000, 1_000);
    expect(single && stepDotLabel(single)).toBe('Open the cart');
    expect(merged && stepDotLabel(merged)).toBe('Open the cart and 2 more steps');
  });

  it('does not count a wait merged into an action as another step', () => {
    const [dot] = placeStepDots([step(1_000, 'Pay'), step(1_010, 'Wait for the page', 'wait')], 10_000, 1_000);
    expect(dot && stepDotLabel(dot)).toBe('Pay');
  });

  it('counts the other waits on a dot made only of waits', () => {
    const [dot] = placeStepDots([step(1_000, 'Look around', 'wait'), step(1_010, 'Wait', 'wait')], 10_000, 1_000);
    expect(dot && stepDotLabel(dot)).toBe('Look around and 1 more step');
  });
});
