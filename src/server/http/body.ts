import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { withSpan } from '../tracing.ts';
import { HttpError } from '../../shared/http-error.ts';

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

/** `25 MB` for whole megabytes, else the exact byte count. */
function sizeLabel(maxBytes: number) {
  return maxBytes % (1024 * 1024) === 0 ? `${maxBytes / 1024 / 1024} MB` : `${maxBytes} bytes`;
}

/**
 * A JSON upload of at most `maxBytes`, before and after decompression. `Content-Encoding: gzip` is accepted, so browsers can
 * send large recordings compressed. `trace` gets sizes only, never the body.
 */
export async function readJsonUpload(request: Request, maxBytes: number, trace: (attributes: Record<string, number | boolean>) => void) {
  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') throw new HttpError(415, `unsupported content-encoding: ${encoding}`);
  const tooLarge = `upload is larger than ${sizeLabel(maxBytes)}`;
  // why: a declared oversize body is refused before any of it is buffered.
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, tooLarge);
  let body: Buffer = await readBytes(request, maxBytes).catch((error: unknown) => {
    throw error instanceof HttpError && error.status === 413 ? new HttpError(413, tooLarge) : error;
  });
  trace({ 'http.request.body.size': body.byteLength });
  if (encoding === 'gzip') {
    try {
      body = await gunzipAsync(body, { maxOutputLength: maxBytes });
    } catch (error) {
      if (error instanceof RangeError || (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE'))
        throw new HttpError(413, `${tooLarge} once decompressed`);
      throw new HttpError(400, 'body is not valid gzip');
    }
  }
  if (body.byteLength === 0) throw new HttpError(400, 'body is empty');
  trace({ 'replay.upload.bytes': body.byteLength, 'replay.upload.gzip': encoding === 'gzip' });
  try {
    return withSpan('replay.parse', { 'replay.upload.bytes': body.byteLength }, () => JSON.parse(body.toString('utf8')) as unknown);
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
}
