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
    expect(captionEdge({ input: pointer([1_000, 200], [1_500, 320]), first: FIRST, height: HEIGHT }, { from: 1_000, to: 2_000 })).toBe(
      'bottom',
    );
  });

  it('moves a caption to the top while the pointer works only where a bottom caption sits', () => {
    expect(captionEdge({ input: pointer([1_000, 700], [1_500, 820]), first: FIRST, height: HEIGHT }, { from: 1_000, to: 2_000 })).toBe(
      'top',
    );
  });

  it('leaves a caption at the bottom when the pointer crosses the whole page, so it never covers the other end', () => {
    expect(captionEdge({ input: pointer([1_000, 120], [1_500, 820]), first: FIRST, height: HEIGHT }, { from: 1_000, to: 2_000 })).toBe(
      'bottom',
    );
  });

  it('reads where the pointer rests from before the caption shows', () => {
    expect(captionEdge({ input: pointer([100, 840]), first: FIRST, height: HEIGHT }, { from: 3_000, to: 5_000 })).toBe('top');
  });

  it('ignores the pointer after the caption has gone', () => {
    expect(captionEdge({ input: pointer([1_000, 300], [4_000, 860]), first: FIRST, height: HEIGHT }, { from: 1_000, to: 2_000 })).toBe(
      'bottom',
    );
  });
});
