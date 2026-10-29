import { createReadStream, type Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';

import { COMPRESSIBLE, CompressionCache, pickEncoding } from '../compression.ts';
import { notModified } from './send.ts';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const compressionCache = new CompressionCache();

/** How a file is served: its caching, and optionally its type, revalidation, extra headers and byte ranges. */
export interface ServeFileOptions {
  cacheControl: string;
  contentType?: string;
  /** Enables If-None-Match revalidation. */
  etag?: boolean;
  headers?: Record<string, string>;
  /** Single byte ranges, for media (`<video>` needs them in Safari). */
  ranges?: boolean;
}

/** A single `bytes=` range within `size`; `'unsatisfiable'` past the end; undefined for no (or a multi-) range. */
function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  const range = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  const [, from = '', to = ''] = range ?? [];
  if (!from && !to) return;
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1;
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

function serveRange(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  file: { info: Stats; headers: Record<string, string> },
) {
  const { info, headers } = file;
  const range = byteRange(request.headers.range, info.size);
  if (range === undefined) return false;
  if (range === 'unsatisfiable') {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
    response.end();
    return true;
  }
  response.writeHead(206, {
    ...headers,
    'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
    'content-length': String(range.end - range.start + 1),
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path, range).pipe(response);
  return true;
}

/** Streams a file, or serves a cached gzip/brotli copy for compressible types; false when there is no such file. */
export async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: ServeFileOptions,
): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;
  const contentType = options.contentType ?? MIME[extname(path)] ?? 'application/octet-stream';
  const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = { ...options.headers, 'content-type': contentType, 'cache-control': options.cacheControl };
  if (options.etag) headers.etag = etag;
  if (options.etag && notModified(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  if (options.ranges) {
    headers['accept-ranges'] = 'bytes';
    if (serveRange(request, response, path, { info, headers })) return true;
  }
  await serveWhole(request, response, path, { info, headers, etag, contentType });
  return true;
}

/** The whole file: a cached gzip/brotli copy for compressible types above 1 KB, else streamed as stored. */
async function serveWhole(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  file: { info: Stats; headers: Record<string, string>; etag: string; contentType: string },
) {
  const { info, headers } = file;
  const compressible = COMPRESSIBLE.test(file.contentType);
  if (compressible) headers.vary = 'Accept-Encoding';
  const encoding = compressible && info.size >= 1024 ? pickEncoding(request.headers['accept-encoding']) : undefined;
  if (encoding) {
    const payload = await compressionCache.get(`${path}|${file.etag}`, encoding, () => readFile(path));
    response.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': String(payload.byteLength) });
    response.end(request.method === 'HEAD' ? undefined : payload);
    return;
  }
  response.writeHead(200, { ...headers, 'content-length': String(info.size) });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
}
