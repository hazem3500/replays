import type { RecorderBodyLimits } from './body-limits.ts';
import type { ReplayConsoleLevel } from './bundle-types.ts';
import type { HttpUploadOptions } from './http-upload.ts';
import type { IssueReport, IssueReportReceipt, IssueReportUpload, RecorderApp } from './upload.ts';

/** Who asked for the recording. Recording still needs the user's consent. */
export type RecorderTrigger =
  | { source: 'user' }
  // why: deprecated for two minors / 90 days; use source: 'host', reason: 'crisp'.
  | { source: 'crisp' }
  | { source: 'host'; reason?: string };

export type StopReason = 'user' | 'max-duration' | 'max-size' | 'page-hidden' | 'no-indicator';

export type RecordingSummary = {
  durationMs: number;
  eventCount: number;
  consoleErrors: number;
  failedRequests: number;
  /** Approximate JSON size of the bundle, in bytes. */
  approxBytes: number;
  stopReason: StopReason;
};

export type RecorderState =
  | { status: 'idle' }
  | { status: 'consent'; trigger: RecorderTrigger }
  | { status: 'starting'; trigger: RecorderTrigger }
  | {
      status: 'recording';
      trigger: RecorderTrigger;
      startedAt: number;
      maxDurationMs: number;
    }
  | { status: 'review'; summary: RecordingSummary }
  | { status: 'uploading'; summary: RecordingSummary; progress?: UploadProgress }
  | { status: 'uploaded'; receipt: IssueReportReceipt }
  | {
      status: 'error';
      phase: 'start' | 'upload';
      error: Error;
      /** Present after a failed upload: the recording is kept for a retry. */
      summary?: RecordingSummary;
    };

export type UploadProgress = { loaded: number; total?: number; fraction?: number };
export type PrivacyFacts = {
  mode: 'masked' | 'visible';
  maxDurationMs: number;
  /** `networkBodies`: request and response content is kept, redacted. */
  captures: { pageText: boolean; inputs: boolean; media: boolean; console: boolean; network: boolean; networkBodies?: boolean };
  reviewRequired: boolean;
};
export type RecorderDecision = { consent: boolean } | { upload: boolean; note?: string };

export type RecorderStatus = RecorderState['status'];

export type UploadDecision = { confirmed: true; note?: string } | { confirmed: false };

/**
 * The in-app prompts. The default (`createDefaultUi`) is a small framework-free
 * dialog + indicator; hosts can render their own (e.g. with the design system)
 * but must keep the same guarantees: explicit consent, a visible indicator with
 * a stop control for the whole recording, and an explicit upload choice.
 */
export type RecorderUi = {
  /**
   * `signal` aborts when the recorder is discarded or destroyed while the
   * prompt is open: close it then (the answer is ignored).
   */
  requestConsent(context: {
    trigger: RecorderTrigger;
    maxDurationMs: number;
    privacy?: PrivacyFacts;
    signal: AbortSignal;
  }): Promise<boolean>;
  /** Shows the recording indicator; returns a function that hides it. */
  showIndicator(context: {
    startedAt: number;
    maxDurationMs: number;
    stop: () => void;
    attestStop?: (element: Element) => () => void;
  }): () => void;
  /** `signal` works as in `requestConsent`. */
  confirmUpload(context: { summary: RecordingSummary; signal: AbortSignal }): Promise<UploadDecision>;
  /**
   * Shown while a confirmed recording uploads; returns a function that hides
   * it.
   */
  respond?(decision: RecorderDecision): void;
  showUploading?(): () => void;
  /** Remove the persistent floating surface and custom renderer resources. */
  dismiss?(): void;
  showResult?(context: { status: 'uploaded'; receipt: IssueReportReceipt } | { status: 'error'; error: Error; retry?: () => void }): void;
};

export type RecorderPrivacyOptions = {
  /** Default true. Internal hosts may opt out of broad page/input masking.
   * Passwords, hidden inputs, credential URLs and auth headers stay protected.
   * This is a host API option, not an end-user privacy toggle.
   */
  sanitize?: boolean;
  /** Mask all page text (rrweb `maskTextSelector: '*'`). Default `true`. */
  maskAllText?: boolean;
  /** Extra selector whose text is masked when `maskAllText` is off. */
  maskTextSelector?: string;
  /**
   * Text inside these elements stays readable even with `maskAllText` (e.g.
   * `[data-recorder-unmask]` on navigation labels). Inputs are always masked;
   * there is no way to unmask them.
   */
  unmaskTextSelector?: string;
  /**
   * Attribute names kept readable on masked elements, in addition to the
   * built-in list (layout, ARIA states, Radix `data-state`…). Every other
   * attribute (`title`, `aria-label`, `placeholder`, `alt`, `data-*`…) is
   * masked like the element's text.
   */
  unmaskAttributes?: readonly string[];
  /**
   * Elements replaced by an empty box of the same size. Added to the defaults.
   * An invalid selector (here or in the text selectors) throws instead of
   * silently blocking nothing.
   */
  blockSelector?: string;
  /** Block images, video, audio, canvas and iframes. Default `true`. */
  blockMedia?: boolean;
  /**
   * Console levels to keep. Default `['warn', 'error']` plus uncaught errors.
   * `[]` turns it off.
   */
  consoleLevels?: readonly ReplayConsoleLevel[];
  /** Record method, URL, status and timing of fetch/XHR calls. Default `true`. */
  captureNetwork?: boolean;
  /** Network headers to keep (allow-list). Default `DEFAULT_ALLOWED_HEADERS`. */
  allowedHeaders?: readonly string[];
};

export type { RecorderBodyLimits } from './body-limits.ts';

/** Nothing, method/URL/status/timing/allow-listed headers (the default), or also redacted bodies. */
export type RecorderCaptureNetwork = 'off' | 'headers' | 'bodies';

/**
 * What a recording keeps beyond the page, shaped like a profile's `capture`
 * block so `profile.capture` from `GET /api/config` can be passed as is. Keys
 * only the capture CLI applies (`performance`, `sampling`, `video`,
 * `stepPauseMs`, `viewport`, `runs`) are ignored. invariant: it only tightens
 * `privacy`; an invalid value throws from `createRecorder`.
 */
export type RecorderCapture = {
  /**
   * Default `'headers'`. `'bodies'` also keeps JSON, text and form bodies of
   * fetch and XHR calls, cut at 64 KiB and redacted before they leave the
   * page. Streams, server-sent events and binary bodies are never read.
   * `privacy.captureNetwork: false` wins.
   */
  network?: RecorderCaptureNetwork;
  /** Lower the body limits; only with `network: 'bodies'`. */
  bodies?: RecorderBodyLimits;
  /** Console levels when `privacy.consoleLevels` is not set. */
  console?: readonly ReplayConsoleLevel[];
  /** Stricter masking than `privacy`; `true` is the only accepted value. */
  privacy?: { maskAllText?: true; blockMedia?: true };
};

/**
 * Which prompts `request()` shows. Both are on by default, which is the
 * customer flow. An internal tool can turn them off for a one-click flow: the
 * user clicks Record, uses the app, clicks Finish, and the recording uploads.
 */
export type RecorderPrompts = {
  /**
   * `false`: calling `request()` from the user's own Record click is the
   * consent, so recording starts without the consent dialog. Default `true`.
   */
  consent?: boolean;
  /**
   * `false`: the recording uploads as soon as it stops, with no review dialog
   * and no note. A failed upload offers Retry. Default `true`.
   */
  review?: boolean;
};

export type RecorderOptions = {
  /** A transport function, or `{ url, headers?, body?, timeoutMs?, credentials? }` for a plain HTTP upload (`createHttpUpload`). */
  upload: IssueReportUpload | HttpUploadOptions;
  /** Turn off the consent and review prompts. Default: both shown. */
  prompts?: RecorderPrompts;
  /** Optional UI. Use createGuidedRecorder from /recorder/ui for the built-in flow. */
  ui?: RecorderUi;
  app?: RecorderApp;
  /** Replay title support sees. Default `Issue report from <app name>`. */
  title?: string;
  /** Default 3 minutes; clamped to 5 s … 10 minutes. */
  maxDurationMs?: number;
  /** Default 15 MB; clamped to 20 MB (Replays accepts 25 MB). */
  maxBytes?: number;
  privacy?: RecorderPrivacyOptions;
  /** Network detail, console levels and stricter masking; bodies stay off unless asked for. */
  capture?: RecorderCapture;
  /**
   * URLs the network capture skips. Uploads run after capture stops, so the
   * upload endpoint never needs listing.
   */
  ignoreUrls?: (string | RegExp)[];
  /** How to load rrweb; default `import('rrweb')`. For tests and custom builds. */
  activation?: () => boolean;
  indicatorGraceMs?: number;
  /** Warn-only during the two-minor / 90-day migration window. */
  strictInvariants?: boolean;
  loadRrweb?: () => Promise<RrwebModule>;
};

/** The part of rrweb the recorder uses. */
export type RrwebModule = {
  record: ((options: Record<string, unknown>) => (() => void) | undefined) & {
    /** Serialized node id → live node; used to mask attributes. */
    mirror?: { getNode(id: number): Node | null };
  };
};

export type Recorder = {
  getState(): RecorderState;
  subscribe(listener: (state: RecorderState) => void): () => void;
  /**
   * The guided flow: consent prompt → recording with indicator → review →
   * upload. Resolves with the receipt, or `undefined` when the user declined,
   * discarded, or the recorder was busy.
   */
  request(trigger?: RecorderTrigger): Promise<IssueReportReceipt | undefined>;
  /** Starts recording. Only call after the user agreed in your own UI. */
  start(options: { consent: true; trigger?: RecorderTrigger }): Promise<void>;
  /** Stops recording and keeps the result in memory for review. */
  stop(reason?: StopReason): RecordingSummary | undefined;
  /** Uploads the reviewed recording. Only call after the user confirmed. */
  upload(options: { confirmed: true; note?: string }): Promise<IssueReportReceipt>;
  respond(decision: RecorderDecision): void;
  retryUpload(): Promise<IssueReportReceipt>;
  attestStop(element: Element): () => void;
  getProgress(): { bytes: number; maxBytes: number; events: number } | undefined;
  /** Drops everything recorded and returns to `idle`. Aborts a running upload. */
  discard(): void;
  /** Host metadata. The legacy crisp field is deprecated for two minors / 90 days. */
  setReportContext(context: Pick<IssueReport, 'crisp' | 'metadata'>): void;
  destroy(): void;
};
