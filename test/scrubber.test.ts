import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  flushPreviewTime,
  getPreviewTime,
  previewStepIndex,
  setPreviewTime,
  subscribePreviewTime,
} from '../src/client/viewer/preview-time.ts';
import {
  barBox,
  bubbleText,
  clampCentre,
  easeOut,
  nearestMark,
  resolveHover,
  notchX,
  runLabel,
  scrubberMarks,
  scrubberSegments,
  segmentAt,
  segmentFill,
  snapIndex,
} from '../src/client/viewer/scrubber-marks.ts';

const steps = [
  { at: 0, label: 'Open the app' },
  { at: 5600, label: 'Start the timer' },
  { at: 5650, label: 'Wait' },
  { at: 5670, label: 'Click Save' },
  { at: 9000, label: 'Confirm saved' },
];
const errors = [
  { at: 5944, label: 'POST /api/timer failed (500)' },
  { at: 9010, label: 'TypeError: x is undefined' },
];

describe('scrubber marks', () => {
  it('labels the bubble with the time, then the mark', () => {
    expect(bubbleText(5600)).toBe('0:05.6');
    expect(bubbleText(5600, 'Start the timer')).toBe('0:05.6 · Start the timer');
  });

  it('names a merged run by its first member and a count', () => {
    expect(runLabel(['Start the timer'])).toBe('Start the timer');
    expect(runLabel(['Start the timer', 'Wait', 'Click Save'])).toBe('Start the timer +2 more');
    expect(runLabel([])).toBe('');
  });

  it('merges marks closer than 8 px, steps before errors', () => {
    // 10 s on 1000 px: 10 ms per px, so 5600/5650/5670 (all within 8 px of the first) merge into one step mark.
    const marks = scrubberMarks(steps, errors, 10_000, 1000);
    expect(marks.map(({ kind, x, label }) => ({ kind, x, label }))).toEqual([
      { kind: 'step', x: 0, label: 'Open the app' },
      { kind: 'step', x: 560, label: 'Start the timer +2 more' },
      { kind: 'step', x: 900, label: 'Confirm saved' },
      { kind: 'error', x: expect.closeTo(594.4), label: 'POST /api/timer failed (500)' },
      { kind: 'error', x: 901, label: 'TypeError: x is undefined' },
    ]);
    // Wider: every step stands alone.
    expect(scrubberMarks(steps, errors, 10_000, 4000).filter((mark) => mark.kind === 'step')).toHaveLength(5);
    expect(scrubberMarks(steps, errors, 0, 1000)).toEqual([]);
  });

  it('gives merged errors one dot and a count', () => {
    const close = [
      { at: 5000, label: 'POST /api/timer failed (500)' },
      { at: 5010, label: 'TypeError: x is undefined' },
    ];
    expect(scrubberMarks([], close, 10_000, 1000)).toEqual([
      { kind: 'error', x: 500, at: 5000, label: '2 errors · POST /api/timer failed (500)' },
    ]);
  });

  it('finds the nearest mark within tolerance; a step wins a tie', () => {
    const marks = scrubberMarks(steps, errors, 10_000, 1000);
    expect(nearestMark(marks, 563, 5)).toBe(1);
    expect(nearestMark(marks, 570, 5)).toBe(-1);
    expect(nearestMark(marks, 900.5, 5)).toBe(2);
    expect(nearestMark(marks, 901, 5)).toBe(4);
  });

  it('keeps the bubble inside the scrubber', () => {
    expect(clampCentre(10, 60, 500)).toBe(30);
    expect(clampCentre(490, 60, 500)).toBe(470);
    expect(clampCentre(250, 60, 500)).toBe(250);
    expect(clampCentre(250, 600, 500)).toBe(250);
  });
});

describe('drag snap and glide', () => {
  it('snaps to the nearest step boundary within 4 px only', () => {
    expect(snapIndex([100, 200, 203], 202, 4)).toBe(2);
    expect(snapIndex([100, 200], 196, 4)).toBe(1);
    expect(snapIndex([100, 200], 195, 4)).toBe(-1);
    expect(snapIndex([], 10, 4)).toBe(-1);
  });

  it('eases out: quick start, exact ends', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.25)).toBeGreaterThan(0.6);
    expect(easeOut(2)).toBe(1);
  });
});

describe('bars', () => {
  it('draws one bar per step span, from 0 to the end', () => {
    // 0.8 px per ms: every bar shows at least 8 px after its 3 px gap.
    expect(scrubberSegments(steps, 10_000, 8000).map(({ start, end, label }) => [start, end, label])).toEqual([
      [0, 5600, 'Open the app'],
      [5600, 5650, 'Start the timer'],
      [5650, 5670, 'Wait'],
      [5670, 9000, 'Click Save'],
      [9000, 10_000, 'Confirm saved'],
    ]);
    // At 0.4 px per ms, 5650–5670 is 8 px wide but would show 5 px: it joins the bar before it.
    expect(scrubberSegments(steps, 10_000, 4000).map(({ start, end }) => [start, end])).toEqual([
      [0, 5600],
      [5600, 5670],
      [5670, 9000],
      [9000, 10_000],
    ]);
  });

  it('merges spans narrower than 8 px into their neighbour, so no bar is a sliver', () => {
    // 0.1 px per ms: 5600–5650 (5 px) and 5650–5670 (2 px) join the bar before them.
    expect(scrubberSegments(steps, 10_000, 1000).map(({ start, end, first, last, label }) => [start, end, first, last, label])).toEqual([
      [0, 5670, 0, 2, 'Open the app +2 more'],
      [5670, 9000, 3, 3, 'Click Save'],
      [9000, 10_000, 4, 4, 'Confirm saved'],
    ]);
  });

  it('merges evenly past 40 bars and draws one bar without steps', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ at: index * 100, label: `Step ${index + 1}` }));
    const bars = scrubberSegments(many, 10_000, 10_000);
    expect(bars.length).toBeLessThanOrEqual(40);
    expect(bars[0]).toMatchObject({ start: 0, first: 0, last: 2, label: 'Step 1 +2 more' });
    expect(bars.at(-1)!.end).toBe(10_000);
    expect(scrubberSegments([], 5000, 500)).toEqual([{ start: 0, end: 5000, first: -1, last: -1, label: '' }]);
    expect(scrubberSegments(steps, 0, 500)).toEqual([]);
  });

  it('keeps error notches on a bar: never in a gap, clear of the rounded caps', () => {
    const bars = scrubberSegments(steps, 10_000, 1000);
    const boxes = bars.map((bar, index) => barBox(bar, index, bars.length, 10_000, 1000));
    // Bar 0 ends at 565.5 px (5670 ms less half a gap); bar 1 starts at 568.5.
    expect(boxes[0]!.left + boxes[0]!.width).toBeCloseTo(565.5);
    expect(boxes[1]!.left).toBeCloseTo(568.5);
    expect(notchX(300, boxes)).toBe(300);
    // In the gap: onto the nearer bar, 2 px in from its end.
    expect(notchX(566, boxes)).toBeCloseTo(563.5);
    expect(notchX(568, boxes)).toBeCloseTo(570.5);
    // At the very ends: off the caps.
    expect(notchX(0, boxes)).toBe(2);
    expect(notchX(1000, boxes)).toBe(998);
  });

  it('fills past bars, part of the current one and none of the future ones', () => {
    const bars = scrubberSegments(steps, 10_000, 8000);
    expect(segmentAt(bars, 0)).toBe(0);
    expect(segmentAt(bars, 5600)).toBe(1);
    expect(segmentAt(bars, 10_000)).toBe(4);
    expect(segmentAt([], 10)).toBe(-1);
    expect(bars.map((bar) => segmentFill(bar, 7335))).toEqual([1, 1, 1, 0.5, 0]);
  });
});

describe('preview time', () => {
  afterEach(() => {
    setPreviewTime(null);
    flushPreviewTime();
  });

  it('coalesces writes to one notification per frame, with the latest value', async () => {
    const listener = vi.fn<() => void>();
    const off = subscribePreviewTime(listener);
    setPreviewTime(100);
    setPreviewTime(200);
    setPreviewTime(300);
    expect(getPreviewTime()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPreviewTime()).toBe(300);
    // Same value again: no notification.
    setPreviewTime(300);
    flushPreviewTime();
    expect(listener).toHaveBeenCalledTimes(1);
    setPreviewTime(null);
    flushPreviewTime();
    expect(getPreviewTime()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it('maps the preview time to the step on screen', () => {
    const times = steps.map((step) => step.at);
    expect(previewStepIndex(times, null)).toBe(-1);
    expect(previewStepIndex([], 100)).toBe(-1);
    expect(previewStepIndex(times, 0)).toBe(0);
    expect(previewStepIndex(times, 5599)).toBe(0);
    expect(previewStepIndex(times, 5600)).toBe(1);
    expect(previewStepIndex(times, 5660)).toBe(2);
    expect(previewStepIndex(times, 5699)).toBe(3);
    expect(previewStepIndex(times, 20_000)).toBe(4);
    expect(previewStepIndex([500, 900], 100)).toBe(0);
  });
});

describe('resolveHover', () => {
  const highlights = [
    { x: 100, at: 14_900, label: 'Checkout opens' },
    { x: 300, at: 30_000, label: 'Payment' },
  ];
  const errors = [{ kind: 'error' as const, x: 200, at: 20_000, label: 'TypeError' }];

  it('names a highlight within its hit radius, ahead of the step under it', () => {
    expect(resolveHover(highlights, errors, 100, 2, 5)).toBe('h0');
    expect(resolveHover(highlights, errors, 106, 2, 5)).toBe('h0');
    expect(resolveHover(highlights, errors, 294, 2, 5)).toBe('h1');
  });

  it('prefers a highlight over an error dot at the same spot', () => {
    expect(resolveHover([{ x: 200, at: 20_000, label: 'Boom' }], errors, 200, 0, 5)).toBe('h0');
  });

  it('falls back to the error dot, then the step, outside the radius', () => {
    expect(resolveHover(highlights, errors, 107, 2, 5)).toBe('s2');
    expect(resolveHover(highlights, errors, 203, 2, 5)).toBe('e0');
    expect(resolveHover([], [], 50, 1, 5)).toBe('s1');
    expect(resolveHover(highlights, errors, 50, -1, 5)).toBe('');
  });
});
