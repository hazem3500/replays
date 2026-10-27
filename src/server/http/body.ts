import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { withSpan } from '../tracing.ts';
import { badJson, HttpError } from './errors.ts';

const gunzipAsync = promisify(gunzip);

/** The body, refusing (413) as soon as it passes `maxBytes`, without buffering the rest. */
export async function readBytes(request: Request, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => null);
      throw new HttpError(413, 'body too large');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, size);
}

/**
 * A JSON upload of at most `maxBytes`, before and after decompression. `Content-Encoding: gzip` is accepted, so browsers can
 * send large recordings compressed. `trace` gets sizes only, never the body.
 */
export async function readJsonUpload(request: Request, maxBytes: number, trace: (attributes: Record<string, number | boolean>) => void) {
  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') throw new HttpError(415, `unsupported content-encoding: ${encoding}`);
  const megabytes = maxBytes / 1024 / 1024;
  let body: Buffer = await readBytes(request, maxBytes).catch((error: unknown) => {
    throw error instanceof HttpError && error.status === 413 ? new HttpError(413, `upload is larger than ${megabytes} MB`) : error;
  });
  trace({ 'http.request.body.size': body.byteLength });
  if (encoding === 'gzip') {
    try {
      body = await gunzipAsync(body, { maxOutputLength: maxBytes });
    } catch (error) {
      if (error instanceof RangeError || (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE'))
        throw new HttpError(413, `upload is larger than ${megabytes} MB once decompressed`);
      throw new HttpError(400, 'body is not valid gzip');
    }
  }
  if (body.byteLength === 0) throw new HttpError(400, 'body is empty');
  trace({ 'replay.upload.bytes': body.byteLength, 'replay.upload.gzip': encoding === 'gzip' });
  try {
    return withSpan('replay.parse', { 'replay.upload.bytes': body.byteLength }, () => JSON.parse(body.toString('utf8')) as unknown);
  } catch {
    throw badJson();
  }
}

/** `JSON.parse` for a request body: a parse failure is the client's (400), never a server error. */
export function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badJson();
  }
}
