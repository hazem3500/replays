import { describe, expect, it } from 'vitest';

import {
  rgbaToThumbHash,
  thumbHashDataUrl,
  thumbHashFromBase64,
  thumbHashToApproximateAspectRatio,
  thumbHashToBase64,
  thumbHashToRGBA,
} from '../src/shared/thumbhash.ts';

/** A 40 × 25 image: a blue band over white, like a page with a header. */
function page(width = 40, height = 25) {
  const rgba: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.push(...(y < 5 ? [40, 70, 200, 255] : [250, 250, 250, 255]));
  return { width, height, rgba };
}

describe('ThumbHash', () => {
  it('is a few dozen bytes that survive base64 and keep the aspect', () => {
    const { width, height, rgba } = page();
    const hash = rgbaToThumbHash(width, height, rgba);
    expect(hash.length).toBeGreaterThan(5);
    expect(hash.length).toBeLessThanOrEqual(25);
    const base64 = thumbHashToBase64(hash);
    expect(base64.length).toBeLessThan(40);
    expect(thumbHashFromBase64(base64)).toEqual(hash);
    expect(thumbHashToApproximateAspectRatio(hash)).toBeCloseTo(width / height, 0);
  });

  it('decodes to a small picture with the source’s colours where they were', () => {
    const { width, height, rgba } = page();
    const image = thumbHashToRGBA(rgbaToThumbHash(width, height, rgba));
    expect(image.w).toBe(32);
    const pixel = (x: number, y: number) => {
      const at = (y * image.w + x) * 4;
      return { r: image.rgba[at] ?? 0, g: image.rgba[at + 1] ?? 0, b: image.rgba[at + 2] ?? 0 };
    };
    const top = pixel(16, 0);
    const bottom = pixel(16, image.h - 1);
    expect(top.b).toBeGreaterThan(top.r);
    expect(Math.min(bottom.r, bottom.g, bottom.b)).toBeGreaterThan(200);
  });

  it('turns a summary’s posterHash into a data URL, and ignores junk', () => {
    const { width, height, rgba } = page();
    const value = thumbHashToBase64(rgbaToThumbHash(width, height, rgba));
    expect(thumbHashDataUrl(value)).toMatch(/^data:image\/png;base64,/);
    expect(thumbHashDataUrl('!!not base64!!')).toBeUndefined();
    expect(thumbHashDataUrl()).toBeUndefined();
  });
});
