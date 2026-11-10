import type { RecorderHostContext } from './host-context.ts';
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
  /**
   * `networkBodies`: request and response content is kept, redacted. `interfaceText`: page text is masked except the
   * product interface marked `data-replay-public`.
   */
  captures: {
    pageText: boolean;
    inputs: boolean;
    media: boolean;
    console: boolean;
    network: boolean;
    networkBodies?: boolean;
    interfaceText?: boolean;
  };
  reviewRequired: boolean;
  /** The host's `app.name`, for copy such as "Acme's menus and labels stay visible". */
  product?: string;
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
  /**
   * Optional step before consent. `request()` calls it only when `choices` offers a real choice; resolve with the
   * user's choice, or `undefined` to cancel. The core ignores anything outside `offer`.
   */
  chooseOptions?(context: {
    trigger: RecorderTrigger;
    offer: RecordingChoiceOffer;
    signal: AbortSignal;
  }): Promise<RecordingChoice | undefined>;
  /** `signal` works as in `requestConsent`; `privacy` is what the reviewed recording captured. */
  confirmUpload(context: { summary: RecordingSummary; privacy?: PrivacyFacts; signal: AbortSignal }): Promise<UploadDecision>;
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

/**
 * How much of the page one recording shows. The host's `privacy` caps every mode. `interface-visible` masks like
 * `masked` but keeps the text of the product interface marked `data-replay-public`; it is the customer default.
 * `inputs-masked` records page text and media but masks typed values; `text-masked` is the older mode that also masks
 * text, still accepted but no longer in the default options menu.
 */
export type RecorderPrivacyMode = 'visible' | 'inputs-masked' | 'text-masked' | 'interface-visible' | 'masked';

/**
 * A profile the deployment defines (`meta.profile`), as the options step shows it. Shaped like the server's
 * configured profiles (`GET /api/config`), so a host can pass them as they come.
 */
export type RecorderProfileOption = {
  id: string;
  /** Default: the id in words. */
  label?: string;
  /** One quiet line under the profile in the menu, such as "A bug to reproduce and fix". */
  description?: string;
};

/** What the user picked for one recording. `networkBodies`: include request and response content. */
export type RecordingChoice = {
  privacy?: RecorderPrivacyMode;
  profile?: string;
  networkBodies?: boolean;
  performance?: boolean;
  debugging?: boolean;
};

/**
 * Opt-in options step: staff, or customers with `by: 'customer'`, choose masking, profile and network content right
 * before each recording. invariant: a mode relaxes masking only as far as the host's own `privacy` allows, and the body
 * option only as far as its `capture` allows; a host whose `privacy` hides text, inputs and media and whose `capture`
 * reads no body (the defaults) never offers a choice.
 */
export type RecorderChoices = {
  /** Offer independent diagnostic toggles, capped by capture.performance/debugging. */
  diagnostics?: boolean;
  /**
   * Who picks. `'customer'`: every recording starts in `interface-visible` without bodies, with `masked` (Fully masked)
   * always offered; `defaults` cannot loosen that, nothing is remembered, a looser mode or bodies need a pick in that
   * recording's options step (a `start()` choice is reduced to the default, or `masked`), only the public marker may
   * unmask text, and the bundle records the pick in `meta.captured.choice`. Default `'staff'`.
   */
  by?: 'staff' | 'customer';
  /**
   * Offer "Include network request and response content", off until picked. Only with `capture.network: 'bodies'`;
   * otherwise the option is not shown. With it, a recording reads bodies only when the option is on.
   */
  networkBodies?: boolean;
  /** Modes to offer. Each is capped by `privacy`; modes the cap makes identical are offered once. */
  privacy?: readonly RecorderPrivacyMode[];
  /** Profiles to offer; the chosen id becomes the bundle's `meta.profile`. */
  profiles?: readonly (string | RecorderProfileOption)[];
  /**
   * The first choice until the user makes one. Default: the most masked mode offered, the first profile and no bodies.
   * `by: 'customer'` uses only its `profile`.
   */
  defaults?: RecordingChoice;
  /** Remember the last choice for this origin in `localStorage`. Default `true`; always off for `by: 'customer'`. */
  remember?: boolean;
};

/** What `chooseOptions` may offer, already capped by the host's `privacy`. */
export type RecordingChoiceOffer = {
  diagnostics?: { performance: boolean; debugging: boolean };
  /** Who picks (`choices.by`). A customer offer lists only allowed modes, in display order. */
  by: 'staff' | 'customer';
  /**
   * Only the modes the host lists and its privacy cap allows, in display order: loosest first for staff; for a customer
   * the default, then Fully masked, then any looser mode.
   * `facts` is what a recording in that mode captures.
   */
  privacy: readonly { mode: RecorderPrivacyMode; facts: PrivacyFacts }[];
  profiles: readonly { id: string; label: string; description?: string }[];
  /** Present when the host offers the body option; `allowed` is false when its `capture` reads no body, and the UI then hides it. */
  networkBodies?: { allowed: boolean };
  /** The remembered choice when it is still offered, else the defaults. Always the defaults for `by: 'customer'`. */
  initial: RecordingChoice;
  /** The host's defaults, reduced to the offer; a UI can mark a choice that differs. */
  defaults: RecordingChoice;
};

/** Nothing, method/URL/status/timing/allow-listed headers (the default), or also redacted bodies. */
export type RecorderCaptureNetwork = 'off' | 'headers' | 'bodies';

/**
 * What a recording keeps beyond the page, shaped like a profile's `capture`
 * block so `profile.capture` from `GET /api/config` can be passed as is. Keys
 * only the capture CLI applies (`sampling`, `video`,
 * `stepPauseMs`, `viewport`, `runs`) are ignored. invariant: it only tightens
 * `privacy`; an invalid value throws from `createRecorder`.
 */
export type RecorderCapture = {
  /** Numeric browser timing diagnostics, independent of text masking. Default false. */
  performance?: boolean;
  /** Bounded redacted diagnostic error context. Default false. */
  debugging?: boolean;
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
  /** Allowlisted host facts, resolved and copied once at recording start. Getter/validation failure omits context without discarding capture. Masked recordings do not call the getter. */
  context?: RecorderHostContext | (() => RecorderHostContext);
  /** Replay title support sees. Default `Issue report from <app name>`. */
  title?: string;
  /** Default 3 minutes; clamped to 5 s … 10 minutes. */
  maxDurationMs?: number;
  /** Default 15 MB; clamped to 20 MB (Replays accepts 25 MB). */
  maxBytes?: number;
  privacy?: RecorderPrivacyOptions;
  /** Network detail, console levels and stricter masking; bodies stay off unless asked for. */
  capture?: RecorderCapture;
  /** Let staff or customers choose masking, profile and network content before each recording. Off unless set; see `RecorderChoices`. */
  choices?: RecorderChoices;
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
  /** Adds a confirmed host action only while recording; masked recordings refuse the label. Never starts or loads capture. */
  annotateStep(step: { label: string }): boolean;
  subscribe(listener: (state: RecorderState) => void): () => void;
  /**
   * The guided flow: consent prompt → recording with indicator → review →
   * upload. Resolves with the receipt, or `undefined` when the user declined,
   * discarded, or the recorder was busy.
   */
  request(trigger?: RecorderTrigger): Promise<IssueReportReceipt | undefined>;
  /**
   * Starts recording. Only call after the user agreed in your own UI. `choice` is capped like `chooseOptions` answers;
   * with `choices.by: 'customer'` it is reduced to Masked without bodies.
   */
  start(options: { consent: true; trigger?: RecorderTrigger; choice?: RecordingChoice }): Promise<void>;
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
