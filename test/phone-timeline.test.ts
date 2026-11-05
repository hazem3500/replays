import { describe, expect, it } from 'vitest';

import { EDITS_VERSION, type ReplayEdits } from '../src/shared/edits.ts';
import { duplicateEffect, splitEffect } from '../src/client/editor/phone-edits.ts';
import { scrollForPlayhead, snapTarget } from '../src/client/editor/phone-scrub.ts';
import { clipRuns, shortRuns } from '../src/client/editor/clip-segments.ts';
import { clampScale, fitScale, MAX_SCALE, stepBoundaries, stepLineLabel, stepLineText } from '../src/client/editor/phone-timeline.ts';

const DURATION = 10_000;
const edits = (extra: Partial<ReplayEdits>): ReplayEdits => ({ version: EDITS_VERSION, cuts: [], ...extra });

describe('splitting a region on the phone timeline', () => {
  it('leaves two regions with the same settings that meet at the playhead', () => {
    const split = splitEffect(edits({ zooms: [{ id: 'zoom-1', from: 1000, to: 5000, scale: 1.8 }] }), {
      kind: 'zoom',
      id: 'zoom-1',
      time: 3000,
      duration: DURATION,
    });
    expect(split?.edits.zooms).toEqual([
      { id: 'zoom-1', from: 1000, to: 3000, scale: 1.8 },
      { id: split?.id, from: 3000, to: 5000, scale: 1.8 },
    ]);
  });

  it('refuses a split that would leave a sliver at either end', () => {
    const before = edits({ captions: [{ id: 'caption-1', from: 1000, to: 5000, text: 'Hi' }] });
    expect(splitEffect(before, { kind: 'caption', id: 'caption-1', time: 1050, duration: DURATION })).toBeUndefined();
    expect(splitEffect(before, { kind: 'caption', id: 'caption-1', time: 4950, duration: DURATION })).toBeUndefined();
  });
});

describe('duplicating a region on the phone timeline', () => {
  it('places the copy right after the original, as long as it is', () => {
    const copy = duplicateEffect(
      edits({ blurs: [{ id: 'blur-1', from: 2000, to: 3000, x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] }),
      'blur',
      'blur-1',
      DURATION,
    );
    expect(copy?.edits.blurs?.at(1)).toEqual({ id: copy?.id, from: 3000, to: 4000, x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
  });

  it('keeps a duplicated speed-up out of the next one', () => {
    const before = edits({
      speeds: [
        { id: 'speed-1', from: 1000, to: 3000, rate: 4 },
        { id: 'speed-2', from: 4000, to: 6000, rate: 2 },
      ],
    });
    expect(duplicateEffect(before, 'speed', 'speed-1', DURATION)?.edits.speeds?.at(-1)).toMatchObject({ from: 3000, to: 4000, rate: 4 });
  });
});

describe('the phone timeline scale', () => {
  it('fits the whole recording inside the screen between its 16 px margins', () => {
    expect(fitScale(390, DURATION) * DURATION).toBe(390 - 32);
  });

  it('zooms out no further than the whole recording and in no further than 400 px a second', () => {
    const fit = fitScale(390, DURATION);
    expect(clampScale(fit / 10, fit)).toBe(fit);
    expect(clampScale(5, fit)).toBe(MAX_SCALE);
  });

  it('leaves the lanes where they are while the playhead shows, and centres it once it leaves the screen', () => {
    const view = { viewport: 390, max: 1_000, follow: false };
    expect(scrollForPlayhead({ ...view, x: 200, scrollLeft: 100 })).toBe(100);
    expect(scrollForPlayhead({ ...view, x: 900, scrollLeft: 100 })).toBe(900 + 16 - 195);
    expect(scrollForPlayhead({ ...view, x: 10, scrollLeft: 300 })).toBe(0);
  });

  it('keeps a playing playhead in the middle once it passes it, within the scroll range', () => {
    const view = { viewport: 390, max: 1_000, follow: true };
    expect(scrollForPlayhead({ ...view, x: 100, scrollLeft: 0 })).toBe(0);
    expect(scrollForPlayhead({ ...view, x: 400, scrollLeft: 0 })).toBe(400 + 16 - 195);
    expect(scrollForPlayhead({ ...view, x: 1_500, scrollLeft: 1_000 })).toBe(1_000);
  });

  it('chooses the later step when it is nearer than an earlier candidate', () => {
    expect(snapTarget(2_250, [2_000, 2_300], 0.0358, 14)).toBe(2_300);
  });

  it('keeps an exact match instead of falling through to an older nearby step', () => {
    expect(snapTarget(2_300, [2_000, 2_300], 0.0358, 14)).toBe(2_300);
  });

  it('keeps the nearest step even when it is less than half a pixel away', () => {
    expect(snapTarget(2_290, [2_000, 2_300], 0.0358, 14)).toBe(2_300);
  });

  it('includes a step exactly at the snap radius', () => {
    expect(snapTarget(1_000, [1_140], 0.1, 14)).toBe(1_140);
  });

  it('leaves a scrub unsnapped when no step is within reach', () => {
    expect(snapTarget(1_000, [800, 1_200], 0.1, 14)).toBeUndefined();
  });

  it('leaves a scrub unsnapped when there are no steps', () => {
    expect(snapTarget(1_000, [], 0.1, 14)).toBeUndefined();
  });

  it('retains the first step on equal distance', () => {
    expect(snapTarget(2_150, [2_000, 2_300], 0.0358, 14)).toBe(2_000);
  });

  it('snaps to each step start inside the recording once', () => {
    expect(stepBoundaries([{ at: 0 }, { at: 1200 }, { at: 1200.4 }, { at: 800 }, { at: 12_000 }], DURATION)).toEqual([800, 1200]);
  });
});

describe('the phone step line', () => {
  const steps = [
    { at: 0, label: 'Open the shop', kind: 'navigate' },
    { at: 2000, label: 'Add the mug to the cart', kind: 'click' },
    { at: 5000, label: 'Wait', kind: 'wait' },
    { at: 7000, label: 'Check out', kind: 'click' },
  ];
  const whole = { start: 0, end: DURATION };

  it('names the step playing at the playhead', () => {
    expect(stepLineLabel(steps, whole, 3500)).toBe('Add the mug to the cart');
  });

  it('names the first kept step while the playhead is in a trimmed-off start', () => {
    expect(stepLineLabel(steps, { start: 2500, end: DURATION }, 1000)).toBe('Add the mug to the cart');
  });

  it('keeps whole words that fit and never ends on a joining word', () => {
    expect(stepLineText('Add the mug to the cart', 32 + 6.6 * 14 + 1)).toBe('Add the mug');
  });
});

describe('short block runs on the phone', () => {
  const blocks = [
    { from: 0, to: 1_000 },
    { from: 1_000, to: 1_400 },
    { from: 1_450, to: 1_800 },
    { from: 3_000, to: 3_300 },
    { from: 3_300, to: 3_600 },
  ];

  it('joins neighbouring short blocks into one run and leaves a lone short block alone', () => {
    expect(shortRuns(blocks, [false, true, true, true, false])).toEqual([{ from: 1_000, to: 1_800, members: [1, 2] }]);
  });

  it('starts a new run across a gap wider than the join distance', () => {
    expect(shortRuns(blocks, [false, true, true, true, true])).toEqual([
      { from: 1_000, to: 1_800, members: [1, 2] },
      { from: 3_000, to: 3_600, members: [3, 4] },
    ]);
  });
});

/** A clip segment at `offset` ms for `length` ms, a wait or a click, with no words. */
const segment = (offset: number, length: number, wait: boolean) => ({
  at: offset,
  offset,
  length,
  label: '',
  kind: wait ? 'wait' : 'click',
  wait,
});

describe('clip runs', () => {
  it('names a run of wordless neighbours once it holds two steps', () => {
    const segments = [segment(0, 100, false), segment(100, 50, true), segment(150, 80, false), segment(230, 900, true)];
    expect(clipRuns(segments, [true, true, true, false])).toEqual([{ from: 0, to: 230, members: [0, 1, 2], steps: 2 }]);
  });

  it('leaves a run of one step and its waits to the ground', () => {
    const segments = [segment(0, 100, false), segment(100, 50, true)];
    expect(clipRuns(segments, [true, true])).toEqual([]);
  });
});
