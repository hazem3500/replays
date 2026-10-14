import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Picks br, then gzip, honouring q-values; undefined means identity. */
export function pickEncoding(header: string | string[] | undefined): Encoding | undefined {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  const accepted = new Map<string, number>();
  for (const part of value.split(',')) {
    const [name, ...parameters] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = parameters.map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter)?.[1]).find(Boolean);
    accepted.set(name, q === undefined ? 1 : Number(q));
  }
  const quality = (name: Encoding) => accepted.get(name) ?? (accepted.has('*') ? accepted.get('*')! : 0);
  if (quality('br') > 0 && quality('br') >= quality('gzip')) return 'br';
  if (quality('gzip') > 0) return 'gzip';
  return undefined;
}

/** Quality 7 brotli and level 6 gzip: most of the size win at a fraction of max-level CPU (results are cached). */
export function compress(body: Buffer, encoding: Encoding) {
  return encoding === 'br'
    ? brotli(body, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 7,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
      })
    : gzipAsync(body, { level: 6 });
}

export const COMPRESSIBLE = /^(text\/|application\/(json|javascript)|image\/svg\+xml)/;

/** Small byte-bounded LRU for compressed representations of immutable inputs. */
export class CompressionCache {
  private readonly entries = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  readonly maxBytes: number;

  constructor(maxBytes = 64 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  async get(key: string, encoding: Encoding, load: () => Promise<Buffer>) {
    const cacheKey = `${encoding}:${key}`;
    const hit = this.entries.get(cacheKey);
    if (hit) {
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, hit);
      return hit;
    }
    const inflight = this.pending.get(cacheKey);
    if (inflight) return inflight;

    const flight = this.fill(cacheKey, encoding, load);
    this.pending.set(cacheKey, flight);
    try {
      return await flight;
    } finally {
      if (this.pending.get(cacheKey) === flight) this.pending.delete(cacheKey);
    }
  }

  private async fill(cacheKey: string, encoding: Encoding, load: () => Promise<Buffer>) {
    const compressed = await compress(await load(), encoding);
    if (compressed.byteLength > this.maxBytes) return compressed;
    const previous = this.entries.get(cacheKey);
    if (previous) this.bytes -= previous.byteLength;
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, compressed);
    this.bytes += compressed.byteLength;
    for (const [oldest, value] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= value.byteLength;
    }
    return compressed;
  }
}
