import { createHash } from 'node:crypto';

import { COMPRESSIBLE, compress, pickEncoding } from '../compression.ts';

/** Default caching for dynamic responses (app.ts `REVALIDATE`): private, and revalidated on every use. */
export const REVALIDATE = 'private, no-cache';
export const JSON_TYPE = 'application/json; charset=utf-8';
export const TEXT_TYPE = 'text/plain; charset=utf-8';

interface ResponseOptions {
  cacheControl?: string;
  headers?: Record<string, string>;
}

export function text(status: number, body: string, options: ResponseOptions & { contentType?: string } = {}) {
  return new Response(body, {
    status,
    headers: { ...options.headers, 'content-type': options.contentType ?? TEXT_TYPE, 'cache-control': options.cacheControl ?? REVALIDATE },
  });
}

export const json = (status: number, value: unknown, options: ResponseOptions = {}) =>
  text(status, JSON.stringify(value), { ...options, contentType: JSON_TYPE });

/** A weak validator for a generated body: the same entity goes out br, gzip or identity-encoded. */
export function bodyEtag(body: Buffer | string) {
  return `W/"${createHash('sha1').update(body).digest('base64url')}"`;
}

/** True when If-None-Match (weak comparison) matches `etag`. */
export function matchesEtag(request: Request, etag: string) {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === bare);
}

/**
 * A generated body, br/gzip-encoded above 1 KB when the client accepts it, and ETag-tagged on 200 so a revalidation costs a
 * 304. `Vary: Accept-Encoding` (the edge adds the host's `Vary`).
 */
export async function compressed(request: Request, status: number, body: string, contentType = JSON_TYPE) {
  const buffer = Buffer.from(body);
  const etag = status === 200 ? bodyEtag(buffer) : undefined;
  const common: Record<string, string> = { 'cache-control': REVALIDATE, vary: 'Accept-Encoding', ...(etag ? { etag } : {}) };
  if (etag && matchesEtag(request, etag)) return new Response(null, { status: 304, headers: common });
  const encoding =
    buffer.byteLength >= 1024 && COMPRESSIBLE.test(contentType)
      ? pickEncoding(request.headers.get('accept-encoding') ?? undefined)
      : undefined;
  const payload = encoding ? await compress(buffer, encoding) : buffer;
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(payload), {
    status,
    headers: {
      ...common,
      'content-type': contentType,
      'content-length': String(payload.byteLength),
      ...(encoding ? { 'content-encoding': encoding } : {}),
    },
  });
}
