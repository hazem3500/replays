import { describe, expect, it } from 'vitest';

import { CLIP_END_INSET_PX, CLIP_GAP_PX, clipBox } from '../src/client/editor/clip-segments.ts';

describe('clipBox', () => {
  it('leaves one gap between neighbours, whichever two they are', () => {
    const a = clipBox(100, 200, { first: false, last: false });
    const b = clipBox(200, 300, { first: false, last: false });
    expect(b.left - (a.left + a.width)).toBe(CLIP_GAP_PX);
  });

  it('keeps the clip ends clear of the trim tabs', () => {
    const first = clipBox(0, 100, { first: true, last: false });
    const last = clipBox(300, 400, { first: false, last: true });
    expect(first.left).toBe(CLIP_END_INSET_PX);
    expect(last.left + last.width).toBe(400 - CLIP_END_INSET_PX);
  });

  it('never goes negative on a narrow segment', () => {
    expect(clipBox(10, 11, { first: true, last: true }).width).toBe(0);
  });
});
