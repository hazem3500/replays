import { gzip, IssueUploadError, type IssueReport, type IssueReportUpload } from './upload.ts';

export type HttpUploadHeaders = Record<string, string>;

/** A plain HTTP upload: any endpoint, any header-based credential. */
export type HttpUploadOptions = {
  /** Where the report is posted, for example a host's upload endpoint. */
  url: string;
  /** Sent with every upload. A function is called once per upload, so short-lived credentials stay fresh. */
  headers?: HttpUploadHeaders | (() => HttpUploadHeaders | Promise<HttpUploadHeaders>);
  /**
   * The request body for a report. Default: the report as JSON, gzipped with `Content-Encoding: gzip` when the browser has
   * `CompressionStream`. A custom body is sent as is; set any `Content-Encoding` in `headers`.
   */
  body?: (report: IssueReport) => BodyInit | Promise<BodyInit>;
  /** Abort and fail (retryable) after this long. Default 60000. */
  timeoutMs?: number;
  /** Default `'omit'`: credentials travel in `headers`, never as cookies. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
};

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** `Retry-After` as milliseconds: delta seconds or an HTTP date; undefined when absent or unreadable. */
function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  if (!Number.isNaN(at)) return Math.max(0, at - now);
}

const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

async function defaultBody(report: IssueReport) {
  const json = JSON.stringify(report);
  const compressed = await gzip(json);
  return compressed ? { body: compressed, headers: { 'content-encoding': 'gzip' } } : { body: json, headers: {} };
}

async function send(options: HttpUploadOptions, report: IssueReport, signal: AbortSignal) {
  const extra = typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
  const built = options.body ? { body: await options.body(report), headers: {} } : await defaultBody(report);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  return doFetch(options.url, {
    method: 'POST',
    signal,
    credentials: options.credentials ?? 'omit',
    headers: { 'content-type': 'application/json', ...built.headers, ...extra },
    body: built.body,
  });
}

/**
 * Posts a confirmed report over HTTP and reads the receipt `{ id, reference?, replayUrl? | url? }`. Failures are
 * `IssueUploadError`s: `retryable` on network errors, timeouts, 408, 429 and 5xx, with `retryAfterMs` from `Retry-After`.
 */
export function createHttpUpload(options: HttpUploadOptions): IssueReportUpload {
  return async (report, { signal }) => {
    // why: AbortSignal.any and AbortSignal.timeout are missing from browsers the recorder still supports.
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 60_000);
    let response: Response;
    try {
      response = await send(options, report, controller.signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new IssueUploadError(timedOut ? 'Upload timed out' : 'Upload failed: network error', 0, { retryable: true, cause: error });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
    if (!response.ok) {
      const wait = retryAfterMs(response.headers.get('retry-after'));
      throw new IssueUploadError(`Upload failed with HTTP ${response.status}`, response.status, {
        retryable: retryable(response.status),
        ...(wait === undefined ? {} : { retryAfterMs: wait }),
      });
    }
    const body: unknown = await response.json().catch(() => null);
    const { id, reference, replayUrl, url } = isRecord(body) ? body : {};
    if (typeof id !== 'string' || !REPLAY_ID.test(id))
      throw new IssueUploadError('Upload response has no valid replay id', response.status);
    const link = typeof replayUrl === 'string' ? replayUrl : url;
    return { replayId: id, ...(typeof reference === 'string' ? { reference } : {}), ...(typeof link === 'string' ? { url: link } : {}) };
  };
}

/** `createRecorder({ upload })` accepts a transport function or these options. */
export const toUpload = (upload: IssueReportUpload | HttpUploadOptions): IssueReportUpload =>
  typeof upload === 'function' ? upload : createHttpUpload(upload);
