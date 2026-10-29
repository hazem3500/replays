import type { ReplayNetworkBody } from './bundle-types.ts';
import { contentTypeAllowed, DEFAULT_BODY_LIMITS, type RecorderBodyLimits } from './body-limits.ts';
import { type BodyInput, captureBody } from './body-redaction.ts';

export type BodyCaptureOptions = {
  limits: RecorderBodyLimits;
  /** Replace e-mail addresses; on while page text is masked. */
  maskEmails: boolean;
  /** Characters kept, counted toward the recording's size cap. */
  onBytes: (bytes: number) => void;
};

/** A body now, a body once a stream copy is read, or no body at all (a GET). */
export type PendingBody = ReplayNetworkBody | Promise<ReplayNetworkBody> | undefined;

/**
 * Reads request and response bodies for the network capture without touching
 * what the page gets: fetch streams are cloned and read in the background,
 * XHR text is already in memory. Every failure yields `omitted: 'unavailable'`.
 */
export type BodyCapture = {
  /** Call before the original fetch runs, so a `Request` body is cloned while unread. */
  fetchRequest(input: RequestInfo | URL, init: RequestInit | undefined, headers: Headers): PendingBody;
  fetchResponse(response: Response): PendingBody;
  xhrRequest(body: unknown, contentType: string | undefined): PendingBody;
  xhrResponse(xhr: XMLHttpRequest): PendingBody;
  /** Cancels every unfinished read (a long poll, a slow stream). */
  dispose(): void;
};

const UNAVAILABLE: ReplayNetworkBody = Object.freeze({ omitted: 'unavailable' });
const leftOut = (size?: number): ReplayNetworkBody => ({ omitted: 'content-type', ...(size === undefined ? {} : { size }) });
const ignore = () => {};

function isBinary(body: unknown) {
  return (
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof Blob === 'function' && body instanceof Blob) ||
    (typeof FormData === 'function' && body instanceof FormData)
  );
}

function contentLength(value: string | null) {
  const length = value ? Number(value) : Number.NaN;
  return Number.isInteger(length) && length >= 0 ? length : undefined;
}

function guard(run: () => PendingBody): PendingBody {
  try {
    const body = run();
    return body instanceof Promise ? body.catch(() => UNAVAILABLE) : body;
  } catch {
    return UNAVAILABLE;
  }
}

type Reading = {
  maxBytes: number;
  allowed: readonly string[];
  maskEmails: boolean;
  onBytes: (bytes: number) => void;
  readers: Set<ReadableStreamDefaultReader<Uint8Array>>;
  disposed: boolean;
};

function wanted(reading: Reading, mimeType: string | undefined) {
  return contentTypeAllowed(mimeType, reading.allowed) && !contentTypeAllowed(mimeType, ['text/event-stream']);
}

function keep(reading: Reading, input: BodyInput, partial = false) {
  const body = captureBody(input, { maxBytes: reading.maxBytes, contentTypes: reading.allowed }, reading.maskEmails);
  // why: `partial` text was cut short here, so its own length is not the body's size.
  if (partial && input.size === undefined) delete body.size;
  if (body.text) reading.onBytes(body.text.length);
  return body;
}

function plainBody(reading: Reading, body: unknown, mimeType: string | undefined): PendingBody {
  if (body === undefined || body === null) return;
  if (typeof body === 'string') return keep(reading, { text: body, mimeType: mimeType ?? 'text/plain;charset=UTF-8' });
  if (body instanceof URLSearchParams)
    return keep(reading, { text: body.toString(), mimeType: mimeType ?? 'application/x-www-form-urlencoded' });
  return isBinary(body) ? leftOut() : UNAVAILABLE;
}

// why: reading stops one byte past the cap, enough to know the body was cut; a disposed read is no body at all.
async function read(reading: Reading, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  reading.readers.add(reader);
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let complete = false;
  try {
    while (bytes <= reading.maxBytes) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (complete) text += decoder.decode();
    else void reader.cancel().catch(ignore);
  } finally {
    reading.readers.delete(reader);
  }
  return reading.disposed ? undefined : { text, bytes, complete };
}

async function streamBody(reading: Reading, stream: ReadableStream<Uint8Array> | null, mimeType: string | undefined, declared?: number) {
  if (!stream) return keep(reading, { text: '', mimeType, size: declared });
  const result = await read(reading, stream);
  if (!result) return UNAVAILABLE;
  return keep(reading, { text: result.text, mimeType, size: result.complete ? result.bytes : declared }, !result.complete);
}

function fetchRequest(reading: Reading, input: RequestInfo | URL, init: RequestInit | undefined, headers: Headers): PendingBody {
  const mimeType = headers.get('content-type') ?? undefined;
  if (init?.body !== undefined || !(input instanceof Request)) {
    if (typeof ReadableStream === 'function' && init?.body instanceof ReadableStream) return UNAVAILABLE;
    return plainBody(reading, init?.body, mimeType);
  }
  if (!input.body) return;
  if (!wanted(reading, mimeType)) return leftOut();
  return streamBody(reading, input.clone().body, mimeType, contentLength(headers.get('content-length')));
}

function fetchResponse(reading: Reading, response: Response): PendingBody {
  const mimeType = response.headers.get('content-type') ?? undefined;
  const declared = contentLength(response.headers.get('content-length'));
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return UNAVAILABLE;
  if (!wanted(reading, mimeType)) return leftOut(declared);
  return streamBody(reading, response.clone().body, mimeType, declared);
}

function xhrRequest(reading: Reading, body: unknown, contentType: string | undefined): PendingBody {
  if (typeof Document === 'function' && body instanceof Document) return UNAVAILABLE;
  if (typeof ReadableStream === 'function' && body instanceof ReadableStream) return UNAVAILABLE;
  return plainBody(reading, body, contentType);
}

function xhrResponse(reading: Reading, xhr: XMLHttpRequest): PendingBody {
  if (xhr.status === 0) return UNAVAILABLE;
  const mimeType = xhr.getResponseHeader('content-type') ?? undefined;
  const declared = contentLength(xhr.getResponseHeader('content-length'));
  if (!wanted(reading, mimeType)) return leftOut(declared);
  if (xhr.responseType === 'arraybuffer' || xhr.responseType === 'blob') return leftOut(declared);
  if (xhr.responseType === 'document') return UNAVAILABLE;
  const text = xhr.responseType === 'json' ? (JSON.stringify(xhr.response) as string | undefined) : xhr.responseText;
  if (text === undefined) return UNAVAILABLE;
  // why: encoding a multi-megabyte response just to cut it would stall the page; maxBytes + 1 characters always overflow the cap.
  const partial = text.length > reading.maxBytes;
  return keep(reading, { text: partial ? text.slice(0, reading.maxBytes + 1) : text, mimeType, size: declared }, partial);
}

export function createBodyCapture(options: BodyCaptureOptions): BodyCapture {
  const reading: Reading = {
    maxBytes: Math.min(options.limits.maxBytes ?? DEFAULT_BODY_LIMITS.maxBytes, DEFAULT_BODY_LIMITS.maxBytes),
    allowed: options.limits.contentTypes ?? DEFAULT_BODY_LIMITS.contentTypes,
    maskEmails: options.maskEmails,
    onBytes: options.onBytes,
    readers: new Set(),
    disposed: false,
  };
  return {
    fetchRequest: (input, init, headers) => guard(() => fetchRequest(reading, input, init, headers)),
    fetchResponse: (response) => guard(() => fetchResponse(reading, response)),
    xhrRequest: (body, contentType) => guard(() => xhrRequest(reading, body, contentType)),
    xhrResponse: (xhr) => guard(() => xhrResponse(reading, xhr)),
    dispose() {
      reading.disposed = true;
      for (const reader of reading.readers) void reader.cancel().catch(ignore);
      reading.readers.clear();
    },
  };
}
