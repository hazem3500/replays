import { describe, expect, it } from 'vitest';

import {
  captionBox,
  editCaptionPlaces,
  placeCaption,
  pointerUnderCaption,
  stepCaptionPlaces,
  type PointerTrack,
} from '../src/client/caption-placement.ts';
import { captionIndex } from '../src/client/step-caption.ts';

const viewport = { width: 1440, height: 900 };
/** Centre of the bottom and top pills for a short label at 1440 × 900 (export scale 1.6). */
const BOTTOM = { x: 720, y: 845 };
const TOP = { x: 720, y: 55 };
const AWAY = { x: 100, y: 450 };

const track = (points: Array<[number, { x: number; y: number }]>, presses: number[] = []): PointerTrack => ({
  points: points.map(([t, at]) => ({ t, ...at })),
  presses,
  viewport,
});

const steps = [
  { at: 0, kind: 'goto', label: 'Open the shop' },
  { at: 1000, kind: 'click', label: 'Keep selected' },
  { at: 3000, kind: 'click', label: 'Checkout' },
];

describe('caption placement', () => {
  it('estimates the pill where step-caption.css draws it, mirrored at the top', () => {
    const bottom = captionBox('bottom', 'Keep selected', viewport);
    const top = captionBox('top', 'Keep selected', viewport);
    expect(bottom.x + bottom.width / 2).toBeCloseTo(720);
    expect(bottom.y + bottom.height).toBeCloseTo(900 - 18 * 1.6);
    expect(top.y).toBeCloseTo(18 * 1.6);
    expect(top.height).toBe(bottom.height);
    const long = captionBox('bottom', 'x'.repeat(90), viewport);
    expect(long.width).toBeCloseTo(0.76 * 1440);
    expect(long.height).toBeGreaterThan(bottom.height);
  });

  it('stays at the bottom when nothing is under it', () => {
    expect(stepCaptionPlaces(steps, track([[0, AWAY]]), 4000)).toEqual(['bottom', 'bottom', 'bottom']);
    expect(stepCaptionPlaces(steps, track([]), 4000)).toEqual(['bottom', 'bottom', 'bottom']);
  });

  it('moves to the top when the pointer rests under the bottom pill', () => {
    const pointer = track([
      [500, AWAY],
      [1200, BOTTOM],
      [2600, AWAY],
    ]);
    expect(stepCaptionPlaces(steps, pointer, 4000)).toEqual(['bottom', 'top', 'bottom']);
  });

  it('ignores a pointer that only passes through', () => {
    const pointer = track([
      [500, AWAY],
      [1200, BOTTOM],
      [1300, AWAY],
    ]);
    expect(stepCaptionPlaces(steps, pointer, 4000)[1]).toBe('bottom');
  });

  it('moves to the top when the step clicks a spot under the bottom pill', () => {
    // why: the pointer leaves right after the click, but the clicked element stays under the caption.
    const pointer = track(
      [
        [500, AWAY],
        [990, BOTTOM],
        [1050, AWAY],
      ],
      [1000],
    );
    expect(stepCaptionPlaces(steps, pointer, 4000)).toEqual(['bottom', 'top', 'bottom']);
  });
});

describe('caption placement across spans', () => {
  it('picks the side covered less when both are, and keeps the bottom on a tie', () => {
    const span = { from: 1000, to: 3000, text: 'Keep selected' };
    const moreBottom = track([
      [1000, BOTTOM],
      [2400, TOP],
    ]);
    expect(placeCaption(moreBottom, span)).toBe('top');
    const moreTop = track([
      [1000, BOTTOM],
      [1600, TOP],
    ]);
    expect(placeCaption(moreTop, span)).toBe('bottom');
    const even = track([
      [1000, BOTTOM],
      [2000, TOP],
    ]);
    expect(placeCaption(even, span)).toBe('bottom');
  });

  it('decides once for the whole span of a caption shared by repeated steps', () => {
    const repeated = [
      { at: 0, kind: 'goto', label: 'Open the calendar' },
      { at: 1000, kind: 'click', label: 'Next month' },
      { at: 1500, kind: 'click', label: 'Next month' },
      { at: 2000, kind: 'click', label: 'Next month' },
      { at: 3000, kind: 'click', label: 'Save' },
    ];
    // why: only the last of the three clicks lands under the caption, yet the shared caption stays at the top throughout.
    const pointer = track(
      [
        [0, AWAY],
        [2000, BOTTOM],
        [2900, AWAY],
      ],
      [1000, 1500, 2000],
    );
    const places = stepCaptionPlaces(repeated, pointer, 4000);
    for (const time of [1000, 1400, 1900, 2500, 2999]) expect(places[captionIndex(repeated, time, 4000)]).toBe('top');
    expect(places[captionIndex(repeated, 3500, 4000)]).toBe('bottom');
  });

  it('places edit captions over their own spans', () => {
    const pointer = track([
      [0, AWAY],
      [1200, BOTTOM],
      [1900, AWAY],
    ]);
    const captions = [
      { from: 1000, to: 2000, text: 'Pick the plan' },
      { from: 2500, to: 3500, text: 'Done' },
    ];
    expect(editCaptionPlaces(captions, pointer)).toEqual(['top', 'bottom']);
  });

  it('says when the pointer is under the shown pill right now', () => {
    const pointer = track([
      [0, AWAY],
      [1200, BOTTOM],
      [1900, AWAY],
    ]);
    expect(pointerUnderCaption(pointer, 1500, { place: 'bottom', text: 'Keep selected', numbered: true })).toBe(true);
    expect(pointerUnderCaption(pointer, 1500, { place: 'top', text: 'Keep selected', numbered: true })).toBe(false);
    expect(pointerUnderCaption(pointer, 2000, { place: 'bottom', text: 'Keep selected', numbered: true })).toBe(false);
    expect(pointerUnderCaption(pointer, 100, { place: 'bottom', text: 'Keep selected', numbered: true })).toBe(false);
  });
});
