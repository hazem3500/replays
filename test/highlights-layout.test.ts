import { describe, expect, it } from 'vitest';

import { highlightTargetOffsets } from '../src/client/highlights-layout.ts';

describe('highlight hit target layout', () => {
  it('separates overlapping controls while leaving each glyph on its timeline position', () => {
    expect(highlightTargetOffsets([100, 110], 320, 44)).toEqual([-17, 17]);
    expect(highlightTargetOffsets([0, 0], 320, 44)).toEqual([22, 66]);
  });

  it('keeps hit targets inside the track at either edge', () => {
    expect(highlightTargetOffsets([0], 320, 44)).toEqual([22]);
    expect(highlightTargetOffsets([320], 320, 44)).toEqual([-22]);
  });

  it('retains stable offsets for unsorted positions', () => {
    expect(highlightTargetOffsets([110, 100], 320, 44)).toEqual([17, -17]);
  });
});
