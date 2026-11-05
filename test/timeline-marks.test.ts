import { describe, expect, it } from 'vitest';

import { formatClock } from '../src/shared/replay.ts';
import { stepSegments } from '../src/client/editor/clip-segments.ts';
import {
  keptLength,
  labelRoom,
  placeStepDots,
  segmentText,
  stepDotDetail,
  stepDotLabel,
  stepMarks,
} from '../src/client/editor/timeline-marks.ts';

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

  it('names a merged dot by its action rather than a wait, at the action and seeking there', () => {
    const [dot] = placeStepDots([step(1_000, 'Wait', 'wait'), step(1_010, 'Click Pay', 'click')], 10_000, 1_000);
    expect([dot?.kind, dot?.label, dot?.at, dot?.seek]).toEqual(['click', 'Click Pay', 1_010, 1_010]);
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

  it('names a wait by its length and the action it follows', () => {
    const [, wait] = placeStepDots([step(1_000, 'Open the cart'), step(2_000, 'Look around', 'wait'), step(3_500, 'Pay')], 10_000, 1_000);
    expect(wait && stepDotLabel(wait)).toBe('Wait, 1.5\u00a0s, after Open the cart');
    expect(wait && stepDotLabel(wait, { spoken: true })).toBe('Wait of 1.5 seconds after Open the cart');
  });
});

describe('placeStepDots with waits', () => {
  it('makes waits back to back one hollow dot that lasts until the next action', () => {
    const dots = placeStepDots([step(1_000, 'Look', 'wait'), step(4_000, 'Wait for the page', 'wait'), step(6_000, 'Pay')], 10_000, 1_000);
    expect(dots.map((dot) => [dot.kind, dot.at, dot.until])).toEqual([
      ['wait', 1_000, 6_000],
      ['click', 6_000, 10_000],
    ]);
  });
});

describe('stepDotDetail', () => {
  it('gives an action its kind and time, so a filled dot reads as something done', () => {
    const [dot] = placeStepDots([step(3_200, 'Pay')], 10_000, 1_000);
    expect(dot && stepDotDetail(dot, 'Click', formatClock)).toMatchObject({ visible: 'Click, 0:03.2', spoken: 'Click at 0:03.2' });
  });

  it('gives a wait where it starts and ends', () => {
    const [wait] = placeStepDots([step(1_000, 'Look around', 'wait'), step(3_100, 'Pay')], 10_000, 1_000);
    expect(wait && stepDotDetail(wait, 'Wait', formatClock)).toMatchObject({ visible: '0:01.0 to 0:03.1', spoken: 'from 0:01.0' });
  });

  it('says in plain words that a hollow dot is a wait', () => {
    const [wait] = placeStepDots([step(1_000, 'Look around', 'wait')], 10_000, 1_000);
    expect(wait && stepDotDetail(wait, 'Wait', formatClock).meaning).toBe('Hollow dots are waits');
  });

  it('runs a last wait to the end of the recording', () => {
    const [wait] = placeStepDots([step(8_500, 'Read the receipt', 'wait')], 10_000, 1_000);
    expect(wait && stepDotLabel(wait, { spoken: true })).toBe('Wait of 1.5 seconds');
  });
});

describe('stepSegments', () => {
  it('runs each kept step from its start to the next one, measured from the trim start', () => {
    const segments = stepSegments([step(1_000, 'Open'), step(4_000, 'Pay'), step(9_000, 'Done')], { start: 2_000, end: 8_000 });
    expect(segments.map(({ label, offset, length }) => [label, offset, length])).toEqual([
      ['Open', 0, 2_000],
      ['Pay', 2_000, 4_000],
    ]);
  });

  it("folds a wait named only as a wait into the step before it, as that step's load", () => {
    const segments = stepSegments([step(1_000, 'Add the tea'), step(1_050, 'Wait for the page', 'wait'), step(2_000, 'Pay')], {
      start: 0,
      end: 3_000,
    });
    expect(segments.map(({ label, offset, length, wait }) => [label, offset, length, wait])).toEqual([
      ['Add the tea', 1_000, 1_000, false],
      ['Pay', 2_000, 1_000, false],
    ]);
  });

  it('joins waits back to back into one dim segment named by its length', () => {
    const segments = stepSegments([step(0, 'Open'), step(500, 'Look', 'wait'), step(1_200, 'Read', 'wait'), step(2_000, 'Pay')], {
      start: 0,
      end: 3_000,
    });
    expect(segments.map(({ label, length, wait }) => [label, length, wait])).toEqual([
      ['Open', 500, false],
      ['Wait 1.5\u00a0s', 1_500, true],
      ['Pay', 1_000, false],
    ]);
  });
});

describe('labelRoom', () => {
  it("stops a segment's words at the first cut inside it", () => {
    expect(labelRoom({ offset: 1_000, length: 2_000 }, 500, [{ from: 2_100, to: 2_600 }])).toEqual({ skip: 0, length: 600 });
  });

  it("starts a segment's words after a cut over its start", () => {
    expect(labelRoom({ offset: 1_000, length: 2_000 }, 500, [{ from: 1_000, to: 1_800 }])).toEqual({ skip: 300, length: 1_700 });
  });

  it('leaves no room in a segment a cut covers whole', () => {
    expect(labelRoom({ offset: 1_000, length: 2_000 }, 500, [{ from: 1_000, to: 4_000 }]).length).toBe(0);
  });
});

/** A label line's width at 6 px a character, so the tests read in whole characters. */
const measure = (text: string) => text.length * 6;

describe('segmentText', () => {
  const wait = { at: 0, offset: 0, length: 1_500, label: 'Wait 1.5\u00a0s', kind: 'wait', wait: true };

  it('gives a wait the hourglass and its kept length, less the cuts over it', () => {
    const kept = keptLength(wait, 0, [{ from: 1_000, to: 3_000 }]);
    expect(segmentText(wait, kept, 200, { measure })).toEqual({ glyph: true, text: '1.0\u00a0s' });
  });

  it('shows a plain block, never the hourglass alone, where the length does not fit', () => {
    expect(segmentText(wait, 1_500, 30, { measure, pad: 4 })).toEqual({ glyph: false, text: '' });
  });

  it('names a step by at least two of its leading words, or none', () => {
    const action = { ...wait, label: 'Type a coupon code', wait: false };
    expect(segmentText(action, 1_500, 100, { measure }).text).toBe('Type a coupon');
    expect(segmentText(action, 1_500, 50, { measure }).text).toBe('');
  });

  it('names a step too short for two of its words by its kind, when that fits whole', () => {
    const action = { ...wait, label: 'Enter an email address', wait: false };
    expect(segmentText(action, 1_500, 50, { measure, fallback: 'Fill' }).text).toBe('Fill');
    expect(segmentText(action, 1_500, 20, { measure, fallback: 'Fill' }).text).toBe('');
  });
});

describe('stepMarks', () => {
  it('moves a wait dot an action joins to that action and says the wait came first', () => {
    const marks = stepMarks([step(0, 'Open'), step(200, 'Look', 'wait'), step(1_100, 'Scroll'), step(2_000, 'Pay')], 2_000);
    const [, scroll] = placeStepDots(marks, 2_000, 100);
    expect(scroll && [scroll.at, scroll.seek]).toEqual([1_100, 1_100]);
    expect(scroll && stepDotDetail(scroll, 'Scroll', formatClock).visible).toBe('Scroll, 0:01.1, after a 0.9\u00a0s wait');
  });

  it('names a wait too close to show apart in the tooltip of the action it follows', () => {
    const marks = stepMarks([step(0, 'Open'), step(100, 'Look', 'wait'), step(900, 'Pay')], 1_000);
    const [open] = placeStepDots(marks, 1_000, 30);
    expect(open && stepDotDetail(open, 'Click', formatClock).visible).toBe('Click, 0:00.0, then a 0.8\u00a0s wait');
  });

  it('marks each wait block once, at its middle, seeking to where the wait begins', () => {
    const marks = stepMarks(
      [step(0, 'Open'), step(1_000, 'Look', 'wait'), step(1_400, 'Wait for the page', 'wait'), step(3_000, 'Pay')],
      4_000,
    );
    const [, wait] = placeStepDots(marks, 4_000, 400);
    expect(marks.map((mark) => mark.kind)).toEqual(['click', 'click', 'wait']);
    expect(wait && [wait.at, wait.seek, wait.until]).toEqual([2_000, 1_000, 3_000]);
  });
});
