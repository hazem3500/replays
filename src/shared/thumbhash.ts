/**
 * ThumbHash (https://evanw.github.io/thumbhash/, MIT) is a ~25-byte blurry stand-in for an image: the server's render
 * page encodes the finished poster, the index decodes it to paint the poster's colours before it loads. Stored as
 * standard base64 of the 5 to 25 hash bytes, so at most 36 characters.
 */
const BASE64_HASH = /^[A-Za-z0-9+/]{7,36}={0,2}$/;

export function isThumbHash(value: unknown): value is string {
  return typeof value === 'string' && BASE64_HASH.test(value);
}

/** The longest side the encoder accepts; callers downscale first. */
export const THUMBHASH_MAX_SIDE = 100;

const read = (values: ArrayLike<number>, index: number) => values[index] ?? 0;

interface Channel {
  dc: number;
  ac: number[];
  scale: number;
}

function encodeChannel(values: Float64Array, { w, h }: { w: number; h: number }, nx: number, ny: number): Channel {
  let dc = 0;
  const ac: number[] = [];
  let scale = 0;
  const fx = new Float64Array(w);
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
      let f = 0;
      for (let x = 0; x < w; x++) fx[x] = Math.cos((Math.PI / w) * cx * (x + 0.5));
      for (let y = 0; y < h; y++) {
        const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
        for (let x = 0; x < w; x++) f += read(values, x + y * w) * read(fx, x) * fy;
      }
      f /= w * h;
      if (cx || cy) {
        ac.push(f);
        scale = Math.max(scale, Math.abs(f));
      } else {
        dc = f;
      }
    }
  }
  return { dc, ac: scale ? ac.map((value) => 0.5 + (0.5 / scale) * value) : ac, scale };
}

/** The image's alpha-weighted average colour (0 to 1) and its total opacity in pixels. */
function averageColor(pixels: number, rgba: ArrayLike<number>) {
  const sum = { r: 0, g: 0, b: 0, a: 0 };
  for (let j = 0; j < pixels * 4; j += 4) {
    const alpha = read(rgba, j + 3) / 255;
    sum.r += (alpha / 255) * read(rgba, j);
    sum.g += (alpha / 255) * read(rgba, j + 1);
    sum.b += (alpha / 255) * read(rgba, j + 2);
    sum.a += alpha;
  }
  const weight = sum.a || 1;
  return { r: sum.r / weight, g: sum.g / weight, b: sum.b / weight, opacity: sum.a };
}

/** Luminance, yellow-blue, red-green and alpha planes, each pixel composited over the average colour. */
function lpqaPlanes(pixels: number, rgba: ArrayLike<number>, average: { r: number; g: number; b: number }) {
  const planes = { l: new Float64Array(pixels), p: new Float64Array(pixels), q: new Float64Array(pixels), a: new Float64Array(pixels) };
  for (let i = 0, j = 0; i < pixels; i++, j += 4) {
    const alpha = read(rgba, j + 3) / 255;
    const r = average.r * (1 - alpha) + (alpha / 255) * read(rgba, j);
    const g = average.g * (1 - alpha) + (alpha / 255) * read(rgba, j + 1);
    const b = average.b * (1 - alpha) + (alpha / 255) * read(rgba, j + 2);
    planes.l[i] = (r + g + b) / 3;
    planes.p[i] = (r + g) / 2 - b;
    planes.q[i] = r - g;
    planes.a[i] = alpha;
  }
  return planes;
}

/** Four AC terms per byte, low nibble first, after the header bytes. */
function packTerms(header: readonly number[], channels: readonly Channel[]) {
  const hash = [...header];
  const start = hash.length;
  let index = 0;
  for (const channel of channels) {
    for (const f of channel.ac) {
      const at = start + (index >> 1);
      hash[at] = (hash[at] ?? 0) | (Math.round(15 * f) << ((index & 1) << 2));
      index++;
    }
  }
  return hash;
}

/** Encodes `w`×`h` RGBA pixels (each side at most THUMBHASH_MAX_SIDE) as a ThumbHash. */
export function rgbaToThumbHash(w: number, h: number, rgba: ArrayLike<number>): Uint8Array {
  if (w > THUMBHASH_MAX_SIDE || h > THUMBHASH_MAX_SIDE || w < 1 || h < 1) throw new Error(`${w}x${h} is not 1 to 100 px a side`);
  const pixels = w * h;
  const average = averageColor(pixels, rgba);
  const hasAlpha = average.opacity < pixels;
  // why: an alpha channel takes hash bits, so luminance keeps fewer terms.
  const limit = hasAlpha ? 5 : 7;
  const lx = Math.max(1, Math.round((limit * w) / Math.max(w, h)));
  const ly = Math.max(1, Math.round((limit * h) / Math.max(w, h)));
  const planes = lpqaPlanes(pixels, rgba, average);
  const size = { w, h };
  const lum = encodeChannel(planes.l, size, Math.max(3, lx), Math.max(3, ly));
  const yellowBlue = encodeChannel(planes.p, size, 3, 3);
  const redGreen = encodeChannel(planes.q, size, 3, 3);
  const landscape = w > h;
  const header24 =
    Math.round(63 * lum.dc) |
    (Math.round(31.5 + 31.5 * yellowBlue.dc) << 6) |
    (Math.round(31.5 + 31.5 * redGreen.dc) << 12) |
    (Math.round(31 * lum.scale) << 18) |
    (Number(hasAlpha) << 23);
  const header16 =
    (landscape ? ly : lx) | (Math.round(63 * yellowBlue.scale) << 3) | (Math.round(63 * redGreen.scale) << 9) | (Number(landscape) << 15);
  const hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8];
  if (!hasAlpha) return new Uint8Array(packTerms(hash, [lum, yellowBlue, redGreen]));
  const alpha = encodeChannel(planes.a, size, 5, 5);
  hash.push(Math.round(15 * alpha.dc) | (Math.round(15 * alpha.scale) << 4));
  return new Uint8Array(packTerms(hash, [lum, yellowBlue, redGreen, alpha]));
}

/** The width-to-height ratio the hash was made from, to the nearest few percent. */
function thumbHashAspectRatio(hash: Uint8Array) {
  const header = read(hash, 3);
  const long = read(hash, 2) & 0x80 ? 5 : 7;
  const landscape = (read(hash, 4) & 0x80) !== 0;
  return landscape ? long / (header & 7) : (header & 7) / long;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** The hash's constants: DC terms, scales and how many luminance terms each axis has. */
function readHeader(hash: Uint8Array) {
  const header24 = read(hash, 0) | (read(hash, 1) << 8) | (read(hash, 2) << 16);
  const header16 = read(hash, 3) | (read(hash, 4) << 8);
  const hasAlpha = header24 >> 23 !== 0;
  const landscape = header16 >> 15 !== 0;
  const long = hasAlpha ? 5 : 7;
  return {
    hasAlpha,
    lx: Math.max(3, landscape ? long : header16 & 7),
    ly: Math.max(3, landscape ? header16 & 7 : long),
    dc: { l: (header24 & 63) / 63, p: ((header24 >> 6) & 63) / 31.5 - 1, q: ((header24 >> 12) & 63) / 31.5 - 1, a: 1 },
    scale: { l: ((header24 >> 18) & 31) / 31, p: ((header16 >> 3) & 63) / 63, q: ((header16 >> 9) & 63) / 63, a: read(hash, 5) >> 4 },
  };
}

/** Reads AC terms in channel order, each nibble mapped back to -1…1 and scaled. */
function termReader(hash: Uint8Array, start: number) {
  let index = 0;
  return (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((read(hash, start + (index >> 1)) >> ((index & 1) << 2)) & 15) / 7.5 - 1) * scale);
        index++;
      }
    }
    return ac;
  };
}

interface Terms {
  ac: readonly number[];
  nx: number;
  ny: number;
  dc: number;
}

/** Sums one channel's terms at a pixel, given that pixel's cosines along x and y. */
function channelAt({ ac, nx, ny, dc }: Terms, fx: Float64Array, fy: Float64Array) {
  let total = dc;
  for (let cy = 0, j = 0; cy < ny; cy++) {
    const fy2 = read(fy, cy) * 2;
    for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++, j++) total += read(ac, j) * read(fx, cx) * fy2;
  }
  return total;
}

/** Decodes a hash into RGBA pixels, at most 32 px a side, in the original's proportions. */
function thumbHashToRgba(hash: Uint8Array) {
  const { hasAlpha, lx, ly, dc, scale } = readHeader(hash);
  const terms = termReader(hash, hasAlpha ? 6 : 5);
  const lum: Terms = { ac: terms(lx, ly, scale.l), nx: lx, ny: ly, dc: dc.l };
  // why: quantization dulls colour; the reference decoder boosts saturation by 1.25 to compensate.
  const yellowBlue: Terms = { ac: terms(3, 3, scale.p * 1.25), nx: 3, ny: 3, dc: dc.p };
  const redGreen: Terms = { ac: terms(3, 3, scale.q * 1.25), nx: 3, ny: 3, dc: dc.q };
  const alpha: Terms = hasAlpha
    ? { ac: terms(5, 5, scale.a / 15), nx: 5, ny: 5, dc: (read(hash, 5) & 15) / 15 }
    : { ac: [], nx: 0, ny: 0, dc: dc.a };
  const ratio = thumbHashAspectRatio(hash);
  const w = Math.round(ratio > 1 ? 32 : 32 * ratio);
  const h = Math.round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const fx = new Float64Array(Math.max(lx, hasAlpha ? 5 : 3));
  const fy = new Float64Array(Math.max(ly, hasAlpha ? 5 : 3));
  for (let y = 0, i = 0; y < h; y++) {
    for (let cy = 0; cy < fy.length; cy++) fy[cy] = Math.cos((Math.PI / h) * (y + 0.5) * cy);
    for (let x = 0; x < w; x++, i += 4) {
      for (let cx = 0; cx < fx.length; cx++) fx[cx] = Math.cos((Math.PI / w) * (x + 0.5) * cx);
      const l = channelAt(lum, fx, fy);
      const p = channelAt(yellowBlue, fx, fy);
      const q = channelAt(redGreen, fx, fy);
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      rgba.set([255 * clamp(r), 255 * clamp(r - q), 255 * clamp(b), 255 * clamp(channelAt(alpha, fx, fy))], i);
    }
  }
  return { w, h, rgba };
}

export function thumbHashToBase64(hash: Uint8Array) {
  return btoa(String.fromCharCode(...hash));
}

function thumbHashFromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: ArrayLike<number>, start: number, end: number) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

/**
 * RGBA pixels as a PNG data URL, without a canvas: one uncompressed (stored) deflate block per row. Tiny images
 * only (a row must fit one stored block, 65535 bytes).
 */
function rgbaToPngDataUrl(w: number, h: number, rgba: ArrayLike<number>) {
  const row = w * 4 + 1;
  const bytes: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (type: string, data: number[]) => {
    const start = bytes.length + 4;
    bytes.push(...u32(data.length), ...Array.from(type, (character) => character.charCodeAt(0)), ...data);
    bytes.push(...u32(crc32(bytes, start, bytes.length)));
  };
  chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]);
  const zlib: number[] = [0x78, 0x01];
  let a = 1;
  let b = 0;
  for (let y = 0; y < h; y++) {
    zlib.push(y + 1 < h ? 0 : 1, row & 255, row >> 8, ~row & 255, (~row >> 8) & 255);
    const line = [0, ...Array.from({ length: w * 4 }, (_, x) => (rgba[y * w * 4 + x] ?? 0) & 255)];
    for (const value of line) {
      a = (a + value) % 65521;
      b = (b + a) % 65521;
    }
    zlib.push(...line);
  }
  zlib.push(...u32(((b << 16) | a) >>> 0));
  chunk('IDAT', zlib);
  chunk('IEND', []);
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return `data:image/png;base64,${btoa(binary)}`;
}

/** A stored hash as a data URL for CSS, or undefined when it is not a hash. */
export function thumbHashDataUrl(value?: string): string | undefined {
  const hash = isThumbHash(value) ? thumbHashFromBase64(value) : new Uint8Array();
  if (hash.length < 5) return;
  const { w, h, rgba } = thumbHashToRgba(hash);
  return rgbaToPngDataUrl(w, h, rgba);
}
