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

export function thumbHashToBase64(hash: Uint8Array) {
  return btoa(String.fromCharCode(...hash));
}
