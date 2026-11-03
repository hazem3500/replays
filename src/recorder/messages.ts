import type { PrivacyFacts, RecordingSummary } from './types.ts';
import type { IssueReportReceipt, IssueUploadErrorDetails } from './upload.ts';

/** A failed start or upload, as handed to the `failed` and `startFailed` messages. */
export type RecorderMessageError = Error & IssueUploadErrorDetails;

/**
 * Every string the built-in recorder UI and the headless store show, including
 * accessible names, tooltips and live announcements. Data-bearing messages are
 * functions so hosts can pluralise and reorder with their own i18n.
 */
export type RecorderMessages = {
  consentTitle: string;
  consentBody: (params: {
    /** The time limit in whole minutes, at least 1. */
    minutes: number;
    maxDurationMs: number;
    /** `maxDurationMs` through `format.duration`. */
    limit: string;
  }) => string;
  /** `privacy` is absent when a host calls the UI without capture facts. */
  consentPrivacy: (params: { mode: 'masked' | 'visible'; privacy?: PrivacyFacts }) => string;
  consentAccept: string;
  consentDecline: string;
  /** Indicator label, the indicator's accessible name and the start announcement. */
  recording: string;
  /** Accessible name and tooltip of the Stop control. */
  stop: string;
  /** Announced once when 30 seconds remain. */
  warningSoon: (params: { seconds: number }) => string;
  /** Announced once when 10 seconds remain. */
  warningFinal: (params: { seconds: number }) => string;
  reviewTitle: string;
  reviewBody: (params: {
    summary: RecordingSummary;
    /** `summary.durationMs` through `format.duration`. */
    duration: string;
    /** `summary.approxBytes` through `format.bytes`. */
    size: string;
  }) => string;
  noteLabel: string;
  send: string;
  discard: string;
  uploading: string;
  sent: (params: {
    /** The receipt's reference, or its replay id. */
    reference: string;
    receipt: IssueReportReceipt;
  }) => string;
  /** Upload failure. An error's own `userMessage` takes precedence. */
  failed: (params: { error: RecorderMessageError; canRetry: boolean }) => string;
  /** Start failure, as reported by `selectError`. An error's own `userMessage` takes precedence. */
  startFailed: (params: { error: RecorderMessageError }) => string;
  retry: string;
  copyLink: string;
  copied: string;
  copyFailed: string;
  /** Accessible name and tooltip of the dismiss control. */
  close: string;
};

/**
 * Input for the `messages` option. A data-bearing key also accepts a template
 * string whose `{param}` placeholders are filled from its number and string
 * params, so overrides written before functions, such as
 * `consentBody: 'Up to {minutes} min'`, keep working.
 */
export type RecorderMessageOverrides = {
  [K in keyof RecorderMessages]?: RecorderMessages[K] | string;
} & {
  /** @deprecated Never rendered; ignored. */
  openReplay?: string;
};

const privacySentence = ({ captures, reviewRequired }: PrivacyFacts) =>
  [
    captures.pageText ? 'Visible page text is recorded.' : 'Page text is masked.',
    captures.inputs ? 'Ordinary inputs are recorded; passwords stay masked.' : 'Inputs are masked.',
    captures.media ? 'Media may be recorded.' : 'Media is blocked.',
    ...(captures.networkBodies ? ['Request and response content is recorded with secrets removed.'] : []),
    reviewRequired ? 'Review before sending.' : 'Sent when you stop.',
  ].join(' ');

/** English copy, without em or en dashes. */
export const defaultRecorderMessages: RecorderMessages = {
  consentTitle: 'Record this tab?',
  consentBody: ({ limit }) => `Up to ${limit}. Stop whenever you like.`,
  consentPrivacy: ({ mode, privacy }) => {
    if (privacy) return privacySentence(privacy);
    return mode === 'visible'
      ? 'Visible page content and ordinary typed values will be recorded. Passwords and hidden fields stay masked. Nothing is sent until you review it.'
      : 'Page text and inputs are masked. Review before sending.';
  },
  consentAccept: 'Start recording',
  consentDecline: 'Not now',
  recording: 'Recording',
  stop: 'Stop',
  warningSoon: ({ seconds }) => `${seconds} seconds left`,
  warningFinal: ({ seconds }) => `${seconds} seconds left`,
  reviewTitle: 'Send recording?',
  reviewBody: ({ duration }) => `Duration: ${duration}.`,
  noteLabel: 'Add a note (optional)',
  send: 'Send recording',
  discard: 'Discard',
  uploading: 'Sending',
  sent: () => 'Recording sent',
  failed: () => "Couldn't send recording",
  startFailed: () => "Couldn't start recording",
  retry: 'Retry',
  copyLink: 'Copy link',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  close: 'Close',
};

/** @deprecated Use `defaultRecorderMessages`. */
export const DEFAULT_MESSAGES: RecorderMessages = defaultRecorderMessages;

const fill = (template: string, params: object) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value: unknown = Reflect.get(params, key);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match;
  });

/** The defaults with `overrides` applied; template strings become functions. */
export function resolveRecorderMessages(overrides: RecorderMessageOverrides = {}): RecorderMessages {
  const messages: Record<string, unknown> = { ...defaultRecorderMessages };
  for (const [key, fallback] of Object.entries(defaultRecorderMessages)) {
    const value: unknown = Reflect.get(overrides, key);
    if (typeof value === 'string' && typeof fallback === 'function') messages[key] = (params: object) => fill(value, params);
    else if (typeof value === typeof fallback) messages[key] = value;
  }
  // invariant: only keys of defaultRecorderMessages are written, each with its default's kind.
  return messages as RecorderMessages;
}
