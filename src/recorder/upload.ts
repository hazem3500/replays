import type { ReplayBundle } from './bundle-types.ts';

/** What the host's upload transport receives once the user confirmed the upload. */
export type IssueReport = {
  bundle: ReplayBundle;
  /** What the user wrote about the problem in the review step, if anything. */
  note?: string;
  /** @deprecated Use metadata. Kept for two minors / 90 days. */
  crisp?: { websiteId?: string; sessionId: string };
  /** Host app identity, from `createRecorder({ app })`. */
  app?: RecorderApp;
  metadata?: Record<string, string | number | boolean>;
};

export type RecorderApp = {
  /** For example `My app`. */
  name: string;
  version?: string;
  environment?: 'production' | 'staging' | 'local';
};

export type IssueReportReceipt = {
  /** The replay id the ingest endpoint stored. Support finds the replay by it. */
  replayId: string;
  /** Optional public support reference; distinct from the internal replay URL. */
  reference?: string;
  /**
   * Where the replay can be watched, when the transport may show it (staff
   * transports only: a customer never gets a replay link).
   */
  url?: string;
};

/**
 * A failed upload the user can act on: the default UI shows `link` next to the
 * message (for example, sign in and retry).
 */
export type IssueUploadErrorLink = { label: string; url: string };

/**
 * Optional fields of an upload error for the default UI. The error's own
 * `message` is never shown (it is technical and untranslated): `userMessage`,
 * when set, replaces the `failed` copy, and `link` is shown next to it.
 */
export type IssueUploadErrorDetails = {
  userMessage?: string;
  link?: IssueUploadErrorLink;
};

/**
 * Sends a confirmed report somewhere support can see it. Hosts provide the transport and authentication appropriate to their deployment.
 */
export type IssueReportUpload = (
  report: IssueReport,
  context: { signal: AbortSignal; onProgress?: (progress: { loaded: number; total?: number }) => void },
) => Promise<IssueReportReceipt>;

export type TokenUploadOptions = {
  /**
   * The ingest endpoint (a gateway in front of Replays), e.g.
   * `https://…/api/issue-reports`.
   */
  endpoint: string;
  /**
   * Returns a short-lived, single-use upload token minted by the host app's own
   * backend for the signed-in user. Called once per upload, never cached.
   */
  getToken: () => Promise<string>;
  /** Gzip the body with `CompressionStream` when available. Default `true`. */
  compress?: boolean;
  fetch?: typeof fetch;
};

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class IssueUploadError extends Error {
  /** The HTTP status, or 0 when no response arrived (network error, timeout). */
  readonly status: number;
  /** Trying again later may succeed: network errors, timeouts, 408, 429 and 5xx. */
  readonly retryable: boolean;
  /** How long the server asked to wait (`Retry-After`), when it said. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, details: { retryable?: boolean; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? {} : { cause: details.cause });
    this.name = 'IssueUploadError';
    this.status = status;
    this.retryable = details.retryable ?? false;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export async function gzip(text: string): Promise<ArrayBuffer | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  const body = new Response(text).body;
  if (!body) return undefined;
  return new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

/**
 * The default transport: `POST endpoint` with `Authorization: Bearer <token>`
 * and the report as (gzipped) JSON. Expects `2xx { "id": "<replay id>" }`. Any
 * URL in the response is ignored: end users never get a replay link.
 */
export function createTokenUpload(options: TokenUploadOptions): IssueReportUpload {
  return async (report, { signal, onProgress }) => {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const token = await options.getToken();
    if (!token) throw new IssueUploadError('No upload token', 401);
    const json = JSON.stringify(report);
    const compressed = options.compress === false ? undefined : await gzip(json);
    let response: Response;
    if (onProgress && !options.fetch && typeof XMLHttpRequest !== 'undefined') {
      response = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => {
          xhr.abort();
          reject(new DOMException('Upload aborted', 'AbortError'));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        xhr.open('POST', options.endpoint);
        xhr.setRequestHeader('authorization', `Bearer ${token}`);
        xhr.setRequestHeader('content-type', 'application/json');
        if (compressed) xhr.setRequestHeader('content-encoding', 'gzip');
        xhr.upload.addEventListener('progress', (event) =>
          onProgress({ loaded: event.loaded, ...(event.lengthComputable ? { total: event.total } : {}) }),
        );
        xhr.addEventListener('load', () => {
          try {
            resolve(new Response(xhr.responseText, { status: xhr.status }));
          } catch (error) {
            reject(error);
          }
        });
        xhr.addEventListener('error', () => reject(new TypeError('Upload failed')));
        xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));
        xhr.addEventListener('loadend', () => signal.removeEventListener('abort', abort));
        signal.addEventListener('abort', abort, { once: true });
        xhr.send(compressed ?? json);
      });
    } else {
      response = await doFetch(options.endpoint, {
        method: 'POST',
        signal,
        credentials: 'omit',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(compressed ? { 'content-encoding': 'gzip' } : {}),
        },
        body: compressed ?? json,
      });
    }
    if (!response.ok) {
      throw new IssueUploadError(`Upload failed with HTTP ${response.status}`, response.status);
    }
    const body = (await response.json().catch(() => undefined)) as { id?: unknown } | undefined;
    const replayId = body?.id;
    if (typeof replayId !== 'string' || !REPLAY_ID.test(replayId)) {
      throw new IssueUploadError('Upload response has no valid replay id', response.status);
    }
    return { replayId };
  };
}
