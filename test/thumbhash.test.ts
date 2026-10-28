import { crc32, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { isThumbHash, rgbaToThumbHash, thumbHashDataUrl, thumbHashToBase64 } from '../src/shared/thumbhash.ts';

type Pixel = [number, number, number, number];

function image(w: number, h: number, color: (x: number, y: number) => Pixel) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(color(x, y), (y * w + x) * 4);
  return rgba;
}

const hashOf = (w: number, h: number, color: (x: number, y: number) => Pixel) =>
  thumbHashToBase64(rgbaToThumbHash(w, h, image(w, h, color)));

/** Reads a PNG data URL back, checking every chunk's CRC; inflate checks the zlib stream's Adler-32. */
function decodePng(url: string | undefined) {
  if (!url?.startsWith('data:image/png;base64,')) throw new Error(`not a PNG data URL: ${url}`);
  const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    expect(png.readUInt32BE(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  expect(raw.length).toBe(stride * height);
  const at = (x: number, y: number): Pixel => {
    const start = y * stride + 1 + x * 4;
    return [raw.readUInt8(start), raw.readUInt8(start + 1), raw.readUInt8(start + 2), raw.readUInt8(start + 3)];
  };
  return { width, height, at };
}

describe('thumbhash', () => {
  it('round-trips a solid colour into an opaque PNG of that colour', () => {
    const hash = hashOf(40, 30, () => [220, 40, 40, 255]);
    expect(isThumbHash(hash)).toBe(true);
    const png = decodePng(thumbHashDataUrl(hash));
    for (const [x, y] of [
      [0, 0],
      [png.width - 1, png.height - 1],
    ] as const) {
      const [r, g, b, a] = png.at(x, y);
      expect(Math.abs(r - 220)).toBeLessThan(16);
      expect(Math.abs(g - 40)).toBeLessThan(16);
      expect(Math.abs(b - 40)).toBeLessThan(16);
      expect(a).toBe(255);
    }
  });

  it('keeps a landscape image landscape and a portrait image portrait', () => {
    const landscape = decodePng(thumbHashDataUrl(hashOf(80, 50, () => [90, 90, 90, 255])));
    const portrait = decodePng(thumbHashDataUrl(hashOf(30, 60, () => [90, 90, 90, 255])));
    expect(landscape.width).toBe(32);
    expect(landscape.height).toBeLessThan(landscape.width);
    expect(portrait.height).toBe(32);
    expect(portrait.width).toBeLessThan(portrait.height);
  });

  it('keeps where the light and dark parts of the image are', () => {
    const png = decodePng(thumbHashDataUrl(hashOf(64, 40, (x) => (x < 32 ? [20, 20, 20, 255] : [240, 240, 240, 255]))));
    const middle = Math.floor(png.height / 2);
    expect(png.at(1, middle)[0]).toBeLessThan(90);
    expect(png.at(png.width - 2, middle)[0]).toBeGreaterThan(170);
  });

  it('keeps transparency where the image had it', () => {
    const png = decodePng(thumbHashDataUrl(hashOf(60, 40, (x) => (x < 30 ? [0, 0, 0, 0] : [30, 120, 220, 255]))));
    const middle = Math.floor(png.height / 2);
    expect(png.at(1, middle)[3]).toBeLessThan(80);
    expect(png.at(png.width - 2, middle)[3]).toBeGreaterThan(200);
  });

  it('refuses images larger than 100 px a side, so callers downscale first', () => {
    expect(() => rgbaToThumbHash(101, 50, new Uint8Array(101 * 50 * 4))).toThrow(/100 px/);
  });

  it('gives no placeholder for a missing or malformed hash', () => {
    expect(thumbHashDataUrl()).toBeUndefined();
    expect(thumbHashDataUrl('not a hash!')).toBeUndefined();
    expect(isThumbHash('AAAA')).toBe(false);
    expect(isThumbHash(`${'A'.repeat(60)}`)).toBe(false);
  });
});
