import { describe, expect, it } from 'vitest';

import { EDITS_VERSION, type ReplayEdits } from '../src/shared/edits.ts';
import { duplicateEffect, splitEffect } from '../src/client/editor/phone-edits.ts';
import { clampScale, fitScale, MAX_SCALE, stepBoundaries, timeAtScroll, wordsThatFit } from '../src/client/editor/phone-timeline.ts';

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
  it('fits the whole recording inside the screen with room on both sides', () => {
    expect(fitScale(390, DURATION) * DURATION).toBe(390 - 48);
  });

  it('zooms out no further than half the fit and in no further than 400 px a second', () => {
    const fit = fitScale(390, DURATION);
    expect(clampScale(fit / 10, fit)).toBe(fit / 2);
    expect(clampScale(5, fit)).toBe(MAX_SCALE);
  });

  it('reads the time under the playhead from the scroll offset, inside the recording', () => {
    expect(timeAtScroll(170, 0.034, DURATION)).toBe(5000);
    expect(timeAtScroll(-20, 0.034, DURATION)).toBe(0);
    expect(timeAtScroll(10_000, 0.034, DURATION)).toBe(DURATION);
  });

  it('snaps to each step start inside the recording once', () => {
    expect(stepBoundaries([{ at: 0 }, { at: 1200 }, { at: 1200.4 }, { at: 800 }, { at: 12_000 }], DURATION)).toEqual([800, 1200]);
  });

  it('shortens a label at a word boundary, never inside a word', () => {
    expect(wordsThatFit('Open checkout page now', 80)).toBe('Open');
  });

  it('wraps a label onto a second line before shortening it', () => {
    expect(wordsThatFit('Open checkout page now', 80, 2)).toBe('Open checkout');
  });

  it('ends a shortened label before a small joining word', () => {
    expect(wordsThatFit('Look at the product grid', 80, 2)).toBe('Look');
  });

  it('keeps a whole label that fits, small words included', () => {
    expect(wordsThatFit('Look at the shop', 200)).toBe('Look at the shop');
  });

  it('shows nothing when even the first word does not fit', () => {
    expect(wordsThatFit('Checkout', 40)).toBe('');
  });
});
