/*
 * Copyright (c) 2023 Evan Wallace. MIT License: https://github.com/evanw/thumbhash/blob/main/LICENSE
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
 * notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * Ported to TypeScript (encode, decode, PNG data URL, base64) from the reference implementation.
 */

type Pixels = ArrayLike<number>;

const at = (values: ArrayLike<number>, index: number) => values[index] ?? 0;

/** The layout a hash's header describes: luminance terms per axis, alpha, orientation. */
interface HashLayout {
  lx: number;
  ly: number;
  hasAlpha: boolean;
  isLandscape: boolean;
}

/** One channel's DCT: the constant term, the normalised varying terms and their scale. */
interface Channel {
  dc: number;
  ac: number[];
  scale: number;
}

function averageColor(w: number, h: number, rgba: Pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = at(rgba, j + 3) / 255;
    r += (alpha / 255) * at(rgba, j);
    g += (alpha / 255) * at(rgba, j + 1);
    b += (alpha / 255) * at(rgba, j + 2);
    a += alpha;
  }
  return a ? { r: r / a, g: g / a, b: b / a, a } : { r, g, b, a };
}

/** RGBA → luminance, yellow–blue, red–green and alpha planes, each pixel composited over the average colour. */
function toLpqa(w: number, h: number, rgba: Pixels) {
  const average = averageColor(w, h, rgba);
  const planes = { l: [] as number[], p: [] as number[], q: [] as number[], a: [] as number[], average };
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = at(rgba, j + 3) / 255;
    const r = average.r * (1 - alpha) + (alpha / 255) * at(rgba, j);
    const g = average.g * (1 - alpha) + (alpha / 255) * at(rgba, j + 1);
    const b = average.b * (1 - alpha) + (alpha / 255) * at(rgba, j + 2);
    planes.l[i] = (r + g + b) / 3;
    planes.p[i] = (r + g) / 2 - b;
    planes.q[i] = r - g;
    planes.a[i] = alpha;
  }
  return planes;
}

/** An image's size, in pixels. */
interface Size {
  w: number;
  h: number;
}

function dctTerm(channel: number[], { w, h }: Size, cx: number, cy: number) {
  let sum = 0;
  for (let y = 0; y < h; y++) {
    const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
    for (let x = 0; x < w; x++) sum += at(channel, x + y * w) * Math.cos((Math.PI / w) * cx * (x + 0.5)) * fy;
  }
  return sum / (w * h);
}

function encodeChannel(channel: number[], size: Size, nx: number, ny: number): Channel {
  let dc = 0;
  const ac: number[] = [];
  let scale = 0;
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
      const f = dctTerm(channel, size, cx, cy);
      if (cx || cy) {
        ac.push(f);
        scale = Math.max(scale, Math.abs(f));
      } else dc = f;
    }
  }
  return { dc, ac: scale ? ac.map((f) => 0.5 + (0.5 / scale) * f) : ac, scale };
}

/** Encodes an RGBA image (not premultiplied; at most 100 × 100) to a ThumbHash. */
export function rgbaToThumbHash(w: number, h: number, rgba: Pixels): Uint8Array {
  if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`);
  const { round, max } = Math;
  const planes = toLpqa(w, h, rgba);
  const hasAlpha = planes.average.a < w * h;
  // why: alpha takes bits from luminance, as in the reference format.
  const limit = hasAlpha ? 5 : 7;
  const lx = max(1, round((limit * w) / max(w, h)));
  const ly = max(1, round((limit * h) / max(w, h)));
  const size = { w, h };
  const l = encodeChannel(planes.l, size, max(3, lx), max(3, ly));
  const p = encodeChannel(planes.p, size, 3, 3);
  const q = encodeChannel(planes.q, size, 3, 3);
  const a = hasAlpha ? encodeChannel(planes.a, size, 5, 5) : undefined;
  const isLandscape = w > h;
  const header24 =
    round(63 * l.dc) | (round(31.5 + 31.5 * p.dc) << 6) | (round(31.5 + 31.5 * q.dc) << 12) | (round(31 * l.scale) << 18) | (Number(hasAlpha) << 23);
  const header16 = (isLandscape ? ly : lx) | (round(63 * p.scale) << 3) | (round(63 * q.scale) << 9) | (Number(isLandscape) << 15);
  const hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8];
  if (a) hash.push(round(15 * a.dc) | (round(15 * a.scale) << 4));
  const start = hash.length;
  const factors = [l.ac, p.ac, q.ac, a?.ac ?? []].flat();
  for (const [index, f] of factors.entries()) {
    const byte = start + (index >> 1);
    hash[byte] = (hash[byte] ?? 0) | (round(15 * f) << ((index & 1) << 2));
  }
  return new Uint8Array(hash);
}

function readLayout(hash: Pixels): HashLayout {
  const hasAlpha = Boolean(at(hash, 2) & 0x80);
  const isLandscape = Boolean(at(hash, 4) & 0x80);
  const header = at(hash, 3) & 7;
  const long = hasAlpha ? 5 : 7;
  return { lx: isLandscape ? long : header, ly: isLandscape ? header : long, hasAlpha, isLandscape };
}

/** The original image's approximate aspect ratio (width / height). */
export function thumbHashToApproximateAspectRatio(hash: Pixels) {
  const { lx, ly } = readLayout(hash);
  return lx / ly;
}

function decodeChannels(hash: Pixels, layout: HashLayout) {
  const header24 = at(hash, 0) | (at(hash, 1) << 8) | (at(hash, 2) << 16);
  const header16 = at(hash, 3) | (at(hash, 4) << 8);
  let index = 0;
  const start = layout.hasAlpha ? 6 : 5;
  const read = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        const nibble = (at(hash, start + (index >> 1)) >> ((index & 1) << 2)) & 15;
        index++;
        ac.push((nibble / 7.5 - 1) * scale);
      }
    return ac;
  };
  const lx = Math.max(3, layout.lx);
  const ly = Math.max(3, layout.ly);
  // why: the reference boosts saturation 1.25× to make up for quantisation.
  return {
    lx,
    ly,
    l: { dc: (header24 & 63) / 63, ac: read(lx, ly, ((header24 >> 18) & 31) / 31) },
    p: { dc: ((header24 >> 6) & 63) / 31.5 - 1, ac: read(3, 3, (((header16 >> 3) & 63) / 63) * 1.25) },
    q: { dc: ((header24 >> 12) & 63) / 31.5 - 1, ac: read(3, 3, (((header16 >> 9) & 63) / 63) * 1.25) },
    a: layout.hasAlpha ? { dc: (at(hash, 5) & 15) / 15, ac: read(5, 5, (at(hash, 5) >> 4) / 15) } : { dc: 1, ac: [] },
  };
}

/** One pixel's cosine bases along x and y. */
interface Basis {
  fx: number[];
  fy: number[];
}

/** Σ ac[j] · fx[cx] · 2fy[cy] over a triangle of DCT terms (nx × ny, the constant term excluded). */
function sumTerms(ac: number[], { fx, fy }: Basis, nx: number, ny: number) {
  let sum = 0;
  let j = 0;
  for (let cy = 0; cy < ny; cy++)
    for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) sum += at(ac, j++) * at(fx, cx) * at(fy, cy) * 2;
  return sum;
}

const channel = (value: number) => Math.max(0, 255 * Math.min(1, value));

/** Decodes a ThumbHash to a small RGBA image (not premultiplied), at most 32 px on its long side. */
export function thumbHashToRGBA(hash: Pixels): { w: number; h: number; rgba: Uint8Array } {
  const layout = readLayout(hash);
  const { lx, ly, l, p, q, a } = decodeChannels(hash, layout);
  // invariant: the size follows the header's own terms (before the minimum of 3), as the reference does.
  const ratio = layout.lx / layout.ly;
  const w = Math.round(ratio > 1 ? 32 : 32 * ratio);
  const h = Math.round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const terms = Math.max(lx, ly, layout.hasAlpha ? 5 : 3);
  for (let y = 0, i = 0; y < h; y++) {
    const fy = Array.from({ length: terms }, (_, cy) => Math.cos((Math.PI / h) * (y + 0.5) * cy));
    for (let x = 0; x < w; x++, i += 4) {
      const fx = Array.from({ length: terms }, (_, cx) => Math.cos((Math.PI / w) * (x + 0.5) * cx));
      const basis = { fx, fy };
      const lum = l.dc + sumTerms(l.ac, basis, lx, ly);
      const pv = p.dc + sumTerms(p.ac, basis, 3, 3);
      const qv = q.dc + sumTerms(q.ac, basis, 3, 3);
      const av = a.dc + (layout.hasAlpha ? sumTerms(a.ac, basis, 5, 5) : 0);
      const b = lum - (2 / 3) * pv;
      const r = (3 * lum - b + qv) / 2;
      rgba[i] = channel(r);
      rgba[i + 1] = channel(r - qv);
      rgba[i + 2] = channel(b);
      rgba[i + 3] = channel(av);
    }
  }
  return { w, h, rgba };
}

const CRC_TABLE = [
  0, 498536548, 997073096, 651767980, 1994146192, 1802195444, 1303535960, 1342533948, -306674912, -267414716, -690576408, -882789492,
  -1687895376, -2032938284, -1609899400, -1111625188,
];

function crc32(bytes: number[], start: number, stop: number) {
  let c = ~0;
  for (let i = start; i < stop; i++) {
    c ^= at(bytes, i);
    c = (c >>> 4) ^ at(CRC_TABLE, c & 15);
    c = (c >>> 4) ^ at(CRC_TABLE, c & 15);
  }
  return ~c;
}

/** An RGBA image (at most 100 × 100) as an uncompressed PNG data URL: fast and dependency-free, not small. */
export function rgbaToDataURL(w: number, h: number, rgba: Pixels) {
  const row = w * 4 + 1;
  const idat = 6 + h * (5 + row);
  const bytes = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, w >> 8, w & 255, 0, 0, h >> 8, h & 255, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    idat >>> 24, (idat >> 16) & 255, (idat >> 8) & 255, idat & 255, 73, 68, 65, 84, 120, 1,
  ];
  let a = 1;
  let b = 0;
  for (let y = 0, i = 0, end = row - 1; y < h; y++, end += row - 1) {
    bytes.push(y + 1 < h ? 0 : 1, row & 255, row >> 8, ~row & 255, (row >> 8) ^ 255, 0);
    for (b = (b + a) % 65521; i < end; i++) {
      const u = at(rgba, i) & 255;
      bytes.push(u);
      a = (a + u) % 65521;
      b = (b + a) % 65521;
    }
  }
  bytes.push(b >> 8, b & 255, a >> 8, a & 255, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130);
  for (const [start, stop] of [
    [12, 29],
    [37, 41 + idat],
  ] as const) {
    const c = crc32(bytes, start, stop);
    bytes.splice(stop, 4, c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes.map((byte) => byte & 255)))}`;
}

/** The hash as the summary carries it (`posterHash`): standard base64, ~34 characters. */
export function thumbHashToBase64(hash: Uint8Array) {
  return btoa(String.fromCharCode(...hash));
}

/** The hash from a summary's `posterHash`; undefined when it is not base64 of a plausible hash. */
export function thumbHashFromBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    return binary.length < 5 || binary.length > 40 ? undefined : Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** A `posterHash` as a data URL for a CSS background; undefined when it is not a valid hash. */
export function thumbHashDataUrl(value?: string) {
  const hash = value ? thumbHashFromBase64(value) : undefined;
  if (!hash) return;
  const image = thumbHashToRGBA(hash);
  return rgbaToDataURL(image.w, image.h, image.rgba);
}
