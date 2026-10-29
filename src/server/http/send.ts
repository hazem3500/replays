import type { IncomingMessage, ServerResponse } from 'node:http';

import { COMPRESSIBLE, compress, pickEncoding } from '../compression.ts';
import { bodyEtag, JSON_TYPE, REVALIDATE, TEXT_TYPE } from './respond.ts';

/** Uploaded replay bundles never change (save() refuses an existing id), so they are cached for a day. */
export const IMMUTABLE_PRIVATE = 'private, max-age=86400, immutable';

/** How a Node response is labelled; text, revalidated on every use, unless given. */
export interface SendOptions {
  contentType?: string;
  cacheControl?: string;
  headers?: Record<string, string>;
}

export function send(response: ServerResponse, status: number, body: string, options: SendOptions = {}): void {
  response.writeHead(status, {
    ...options.headers,
    'content-type': options.contentType ?? TEXT_TYPE,
    'cache-control': options.cacheControl ?? REVALIDATE,
  });
  response.end(body);
}

export function sendJson(response: ServerResponse, status: number, value: unknown, options: Omit<SendOptions, 'contentType'> = {}): void {
  send(response, status, JSON.stringify(value), { ...options, contentType: JSON_TYPE });
}

/** True when If-None-Match (weak comparison) matches `etag`. */
export function notModified(request: IncomingMessage, etag: string): boolean {
  const header = request.headers['if-none-match'];
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header === '*' || header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === bare);
}

/**
 * A generated 200 body, gzip/brotli-encoded above 1 KB when the client accepts it, and ETag-tagged so a revalidation
 * (`no-cache`) costs a 304 instead of the body.
 */
export async function sendGenerated(request: IncomingMessage, response: ServerResponse, body: string, contentType: string): Promise<void> {
  const buffer = Buffer.from(body);
  const etag = bodyEtag(buffer);
  // why: a `Vary` already on the response (`Host` with per-host bases) must survive, including on the 304.
  const vary = ['Accept-Encoding', response.getHeader('vary')].filter((value) => typeof value === 'string' && value).join(', ');
  const common = { 'cache-control': REVALIDATE, vary, etag };
  if (notModified(request, etag)) {
    response.writeHead(304, common);
    response.end();
    return;
  }
  const encoding =
    buffer.byteLength >= 1024 && COMPRESSIBLE.test(contentType) ? pickEncoding(request.headers['accept-encoding']) : undefined;
  const payload = encoding ? await compress(buffer, encoding) : buffer;
  response.writeHead(200, {
    ...common,
    'content-type': contentType,
    'content-length': String(payload.byteLength),
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : payload);
}

/** Browsers send `Sec-Fetch-Site`; a state-changing request from another site is refused. CLI clients send none. */
export function sameOrigin(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}

/** A top-level page load from a browser, as opposed to a health check or API client. */
export function isBrowserNavigation(request: IncomingMessage): boolean {
  if (request.headers['sec-fetch-mode'] === 'navigate') return true;
  return (request.headers.accept ?? '').includes('text/html');
}
