import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { notModified } from './app.ts';
import { COMPRESSIBLE, CompressionCache, pickEncoding } from './compression.ts';
import type { ObjectInfo, ObjectStorage } from './storage/index.ts';

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
};

/** Compressed copies of stored JSON (bundles), keyed by object version: never stale, ~64 MB at most. */
const compressionCache = new CompressionCache();

/** The weak validator for a stored object: size and version (fs: the mtime, as before; GCS: the generation). */
export function objectEtag(info: Pick<ObjectInfo, 'size' | 'version'>) {
  return `W/"${info.size.toString(36)}-${info.version}"`;
}

/**
 * Streams a stored object through the server (the app's auth stays the only way in: no public or signed URLs),
 * like serveFile: weak ETag + 304 when `etag`, single byte ranges when `ranges` (video), and br/gzip for
 * compressible types from a cache keyed by the object's version. Returns false when there is no object.
 * `info` skips the stat when the caller already has it (locate()).
 */
export async function serveObject(
  request: IncomingMessage,
  response: ServerResponse,
  storage: ObjectStorage,
  key: string,
  cacheControl: string,
  options: { contentType?: string; etag?: boolean; headers?: Record<string, string>; ranges?: boolean; info?: ObjectInfo } = {},
) {
  const info = options.info ?? (await storage.stat(key));
  if (!info) return false;
  const contentType = options.contentType ?? MIME[extname(key)] ?? 'application/octet-stream';
  const etag = objectEtag(info);
  const headers: Record<string, string> = { ...options.headers, 'content-type': contentType, 'cache-control': cacheControl };
  // A 304 updates the stored representation's metadata: keep the same Vary as the 200.
  const vary = [response.getHeader('vary'), headers.vary, COMPRESSIBLE.test(contentType) ? 'Accept-Encoding' : undefined]
    .filter(Boolean)
    .join(', ');
  if (vary) headers.vary = vary;
  if (options.etag) headers.etag = etag;
  if (options.etag && notModified(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  const send = async (status: number, extra: Record<string, string>, range?: { start: number; end: number }) => {
    if (request.method === 'HEAD') {
      response.writeHead(status, { ...headers, ...extra });
      response.end();
      return;
    }
    // Open the object before the head goes out, so a vanished object (pruned meanwhile) can still be a 404.
    const body = await storage.stream(key, range);
    response.writeHead(status, { ...headers, ...extra });
    await pipeline(body, response).catch((error: unknown) => {
      // A client that goes away mid-video is normal; anything else is logged (headers are already out).
      if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`streaming ${key} failed:`, error);
      response.destroy();
    });
  };
  // Single byte ranges for media (<video> needs them in Safari); multi-range requests get the whole object.
  if (options.ranges) {
    headers['accept-ranges'] = 'bytes';
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? '').trim());
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` });
        response.end();
        return true;
      }
      await send(206, { 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': String(end - start + 1) }, { start, end });
      return true;
    }
  }
  const encoding = COMPRESSIBLE.test(contentType) && info.size >= 1024 ? pickEncoding(request.headers['accept-encoding']) : undefined;
  if (encoding) {
    const payload = await compressionCache.get(`${storage.description}|${key}|${etag}`, encoding, async () => {
      const body = await storage.read(key);
      if (!body) throw Object.assign(new Error(`${key} vanished`), { status: 404 });
      return body;
    });
    response.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': String(payload.byteLength) });
    response.end(request.method === 'HEAD' ? undefined : payload);
    return true;
  }
  await send(200, { 'content-length': String(info.size) });
  return true;
}
