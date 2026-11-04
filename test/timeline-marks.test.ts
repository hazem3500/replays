import { describe, expect, it } from 'vitest';

import { formatClock } from '../src/shared/replay.ts';
import { placeStepDots, stepDotDetail, stepDotLabel } from '../src/client/editor/timeline-marks.ts';

const step = (at: number, label = `Step at ${at}`, kind = 'click') => ({ at, label, kind });

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

describe('stepDotDetail', () => {
  it('gives an action its kind and time, so a filled dot reads as something done', () => {
    const [dot] = placeStepDots([step(3_200, 'Pay')], 10_000, 1_000);
    expect(dot && stepDotDetail(dot, 'Click', formatClock)).toEqual({ visible: 'Click · 0:03.2', spoken: 'Click at 0:03.2' });
  });

  it('gives a wait how long it lasts, up to the next dot', () => {
    const [wait] = placeStepDots([step(1_000, 'Look around', 'wait'), step(3_100, 'Pay')], 10_000, 1_000);
    expect(wait && stepDotDetail(wait, 'Wait', formatClock).visible).toBe('Wait · 2.1 s');
  });

  it('runs a last wait to the end of the recording', () => {
    const [wait] = placeStepDots([step(8_500, 'Read the receipt', 'wait')], 10_000, 1_000);
    expect(wait && stepDotDetail(wait, 'Wait', formatClock).spoken).toBe('Wait of 1.5 seconds at 0:08.5');
  });
});
