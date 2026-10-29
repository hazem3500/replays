import { describe, expect, it } from 'vitest';

import { captionEdge } from '../src/client/caption-placement.ts';
import type { CursorInput } from '../src/client/cursor-motion.ts';

const FIRST = 1_000;
const HEIGHT = 900;
const pointer = (...points: Array<[at: number, y: number]>): CursorInput => ({
  points: points.map(([at, y]) => ({ t: FIRST + at, x: 400, y })),
  presses: [],
});

describe('caption placement', () => {
  it('keeps a caption at the bottom while the pointer works in the upper page', () => {
    expect(captionEdge(pointer([1_000, 200], [1_500, 320]), FIRST, HEIGHT, 1_000, 2_000)).toBe('bottom');
  });

  it('moves a caption to the top while the pointer works only where a bottom caption sits', () => {
    expect(captionEdge(pointer([1_000, 700], [1_500, 820]), FIRST, HEIGHT, 1_000, 2_000)).toBe('top');
  });

  it('leaves a caption at the bottom when the pointer crosses the whole page, so it never covers the other end', () => {
    expect(captionEdge(pointer([1_000, 120], [1_500, 820]), FIRST, HEIGHT, 1_000, 2_000)).toBe('bottom');
  });

  it('reads where the pointer rests from before the caption shows', () => {
    expect(captionEdge(pointer([100, 840]), FIRST, HEIGHT, 3_000, 5_000)).toBe('top');
  });

  it('ignores the pointer after the caption has gone', () => {
    expect(captionEdge(pointer([1_000, 300], [4_000, 860]), FIRST, HEIGHT, 1_000, 2_000)).toBe('bottom');
  });
});
