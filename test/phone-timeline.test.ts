import { describe, expect, it } from 'vitest';

import { EDITS_VERSION, type ReplayEdits } from '../src/shared/edits.ts';
import { duplicateEffect, splitEffect } from '../src/client/editor/phone-edits.ts';
import { scrollForPlayhead, snapTarget } from '../src/client/editor/phone-scrub.ts';
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

  it('settles a scrub on a step start within reach, and not on one it already sits on', () => {
    expect(snapTarget(1_150, [800, 1_200], 0.1, 14)).toBe(1_200);
    expect(snapTarget(1_000, [800, 1_200], 0.1, 14)).toBeUndefined();
    expect(snapTarget(1_200, [1_200], 0.1, 14)).toBeUndefined();
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
