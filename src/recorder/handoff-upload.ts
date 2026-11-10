import {
  HANDOFF_CHANNEL,
  HANDOFF_PATH,
  HANDOFF_VERSION,
  MAX_HANDOFF_CHARS,
  newHandoffId,
  parseHandoffMessage,
  type HandoffBundle,
} from './handoff-protocol.ts';
import type { IssueReportReceipt } from './upload.ts';

/** Why a handoff did not produce a receipt. */
export type HandoffFailureKind =
  /** The browser refused the window (no user gesture, or a blocker). */
  | 'blocked'
  /** The person closed the window before the upload finished. */
  | 'closed'
  /** No ready message or no receipt within the time allowed. */
  | 'timeout'
  | 'too-large'
  | 'aborted'
  /** Replays answered the upload with an error status. */
  | 'rejected';

export class HandoffUploadError extends Error {
  readonly kind: HandoffFailureKind;
  /** The status Replays answered, when `kind` is `rejected`. */
  readonly status: number | undefined;

  constructor(kind: HandoffFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'HandoffUploadError';
    this.kind = kind;
    this.status = status;
  }
}

/** The browser pieces the handoff uses; tests pass fakes. */
export type HandoffHost = {
  open: (url: string, name: string, features: string) => WindowProxy | null;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
};

export type HandoffUploadOptions = {
  /** Toggl Replays, without a trailing slash. */
  replaysUrl: string;
  /** The bundle as the JSON text `POST /api/replays` takes. */
  payload: string;
  signal?: AbortSignal;
  /** Wait this long for the page to load, which includes signing in there. Default 3 minutes. */
  readyTimeoutMs?: number;
  /** Wait this long for the receipt after the bundle is sent; longer for a large payload. Default 60 seconds. */
  uploadTimeoutMs?: number;
  /** Refuse a larger payload before opening anything. Default `MAX_HANDOFF_CHARS`. */
  maxChars?: number;
  /** How often to check whether the person closed the window. Default 500 ms. */
  closedPollMs?: number;
  host?: HandoffHost;
};

export const DEFAULT_HANDOFF_READY_TIMEOUT_MS = 180_000;
export const DEFAULT_HANDOFF_UPLOAD_TIMEOUT_MS = 60_000;
const MIN_CHARS_PER_MS = 32;
const WINDOW_NAME = 'replays-upload-handoff';
const WINDOW_FEATURES = 'popup,width=520,height=640';

function browserHost(): HandoffHost {
  return {
    open: (url, name, features) => window.open(url, name, features),
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

/**
 * Uploads through the Replays first-party page: opens `<replaysUrl>/upload`, waits for its `ready`, sends the bundle to
 * that origin only, and resolves with the receipt it posts back. Call it from a click, so the browser allows the window.
 *
 * invariant: a message counts only when `event.source` is the window opened here and `event.origin` is exactly the
 * Replays origin; the bundle is posted with that origin as `targetOrigin`, never `*`.
 */
export function handoffUpload(options: HandoffUploadOptions): Promise<IssueReportReceipt> {
  const base = options.replaysUrl.replace(/\/+$/, '');
  const replaysOrigin = new URL(base).origin;
  const maxChars = options.maxChars ?? MAX_HANDOFF_CHARS;
  if (options.payload.length > maxChars)
    return Promise.reject(new HandoffUploadError('too-large', 'The recording is larger than the handoff accepts.'));
  if (options.signal?.aborted) return Promise.reject(new HandoffUploadError('aborted', 'The upload was cancelled.'));

  const host = options.host ?? browserHost();
  const opened = host.open(`${base}${HANDOFF_PATH}`, WINDOW_NAME, WINDOW_FEATURES);
  if (!opened) return Promise.reject(new HandoffUploadError('blocked', 'The browser did not open the Replays window.'));

  const popup: WindowProxy = opened;
  const id = newHandoffId();
  const readyMs = options.readyTimeoutMs ?? DEFAULT_HANDOFF_READY_TIMEOUT_MS;
  const uploadMs = Math.max(
    options.uploadTimeoutMs ?? DEFAULT_HANDOFF_UPLOAD_TIMEOUT_MS,
    Math.ceil(options.payload.length / MIN_CHARS_PER_MS),
  );

  return new Promise<IssueReportReceipt>((resolve, reject) => {
    let sent = false;
    let finished = false;
    let deadline: ReturnType<typeof setTimeout>;
    let closedTimer: ReturnType<typeof setInterval>;

    const finish = (outcome: () => void, closeWindow = true) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearInterval(closedTimer);
      host.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
      if (closeWindow) {
        try {
          popup.close();
        } catch {
          // The window is already gone.
        }
      }
      outcome();
    };
    const fail = (kind: HandoffFailureKind, message: string, status?: number, closeWindow = true) =>
      finish(() => reject(new HandoffUploadError(kind, message, status)), closeWindow);

    const arm = (ms: number) => {
      clearTimeout(deadline);
      deadline = setTimeout(
        () => fail('timeout', sent ? 'Toggl Replays did not answer in time.' : 'The Replays window did not get ready in time.'),
        ms,
      );
    };

    function onMessage(event: MessageEvent) {
      if (event.source !== popup || event.origin !== replaysOrigin) return;
      if (!sent) {
        if (!parseHandoffMessage(event.data, ['ready'])) return;
        sent = true;
        const message: HandoffBundle = {
          channel: HANDOFF_CHANNEL,
          version: HANDOFF_VERSION,
          type: 'bundle',
          id,
          payload: options.payload,
        };
        popup.postMessage(message, replaysOrigin);
        arm(uploadMs);
        return;
      }
      const receipt = parseHandoffMessage(event.data, ['receipt']);
      if (receipt?.id !== id) return;
      if (!receipt.ok) {
        fail('rejected', `Toggl Replays refused the upload (${String(receipt.status)}).`, receipt.status);
        return;
      }
      const path = receipt.url ?? `/r/${encodeURIComponent(receipt.replayId)}`;
      finish(() => resolve({ replayId: receipt.replayId, url: `${base}${path}` }));
    }
    function onAbort() {
      fail('aborted', 'The upload was cancelled.');
    }

    host.addEventListener('message', onMessage);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    arm(readyMs);
    // why: a message the window posted just before closing is delivered before the next poll sees `closed`.
    closedTimer = setInterval(() => {
      if (popup.closed) fail('closed', 'The Replays window was closed before the upload finished.', undefined, false);
    }, options.closedPollMs ?? 500);
  });
}
