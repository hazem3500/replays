import type { PrivacyFacts, RecorderPrivacyMode, RecordingSummary } from './types.ts';
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
  /**
   * `privacy` is absent when a host calls the UI without capture facts; its `product` is the host's `app.name`.
   */
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
  /** Review: what the reviewed recording captured, from the same facts as the consent notice. */
  reviewPrivacy: (params: { privacy: PrivacyFacts }) => string;
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
  /** Default primary completion action: opens the receipt URL in a new tab. */
  openLink: string;
  copyLink: string;
  copied: string;
  copyFailed: string;
  /** Accessible name and tooltip of the dismiss control. */
  close: string;
  /** Options step: the pill's and the options button's accessible name, and the step's announcement. */
  optionsTitle: string;
  /** Options step: the current choice, as the options button's tooltip. Params are display names. */
  optionsSummary: (params: { privacy?: string; profile?: string }) => string;
  /** Options step: heading of the masking group in the options menu. */
  privacyLabel: string;
  /** Options step: heading of the profile group in the options menu. */
  profileLabel: string;
  /** Options step: why a masking mode is unavailable (the host's privacy does not allow it). */
  privacyUnavailable: string;
  /** Options step: a masking mode's name. */
  privacyMode: (params: { mode: RecorderPrivacyMode }) => string;
  /** Options step: one quiet line under a masking mode, from what a recording in that mode captures. */
  privacyHint: (params: { mode: RecorderPrivacyMode; privacy: PrivacyFacts }) => string;
  /** Options step: heading of the network group in the options menu. */
  networkLabel: string;
  /** Options step: the option that adds request and response content to the recording. */
  networkBodies: string;
  /** Options step: the button that starts the recording. */
  record: string;
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

const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''));

/** What a recording captures, from its facts, without the review sentence. */
const recordedSentence = ({ captures, product }: PrivacyFacts) => {
  const interfaceOnly = captures.interfaceText === true && !captures.pageText;
  const hidden = [
    !captures.pageText && !interfaceOnly && 'page text',
    !captures.inputs && !interfaceOnly && 'inputs',
    !captures.media && 'media',
  ].filter((item) => item !== false);
  const hiddenSentence = hidden.length ? `${listed(hidden)} ${hidden.length > 1 ? 'are' : 'is'} hidden.` : '';
  return [
    interfaceOnly
      ? `Your entries, names and typed text are hidden; ${product ? `${product}'s` : "the app's"} menus and labels stay visible.`
      : '',
    hiddenSentence.charAt(0).toUpperCase() + hiddenSentence.slice(1),
    captures.pageText ? 'Visible page text is recorded.' : '',
    captures.inputs ? 'Typed values are recorded; passwords and hidden fields stay hidden.' : '',
    captures.media ? 'Media may be recorded.' : '',
    captures.networkBodies ? 'Request and response content is recorded with secrets removed.' : '',
  ]
    .filter(Boolean)
    .join(' ');
};

const privacySentence = (facts: PrivacyFacts) =>
  `${recordedSentence(facts)} ${facts.reviewRequired ? 'You review it before it is sent.' : 'It is sent when you stop.'}`;

const MODE_NAMES: Record<RecorderPrivacyMode, string> = {
  visible: 'Visible',
  'text-masked': 'Text masked',
  'interface-visible': 'Your data hidden',
  masked: 'Fully masked',
};

/** One short line per mode, from what it actually records once the host's cap applies. */
const modeHint = ({ captures }: PrivacyFacts) => {
  const recorded = [captures.pageText && 'text', captures.inputs && 'inputs'].filter((item) => item !== false);
  if (recorded.length) return `Records ${listed(recorded)}`;
  if (captures.interfaceText) return "Shows only the app's menus and labels";
  return captures.media ? 'Hides text and inputs' : 'Hides everything';
};

/** English copy, without em or en dashes. */
export const defaultRecorderMessages: RecorderMessages = {
  consentTitle: 'Record this tab?',
  consentBody: ({ limit }) => `Up to ${limit}. Stop whenever you like.`,
  consentPrivacy: ({ mode, privacy }) => {
    if (privacy) return privacySentence(privacy);
    return mode === 'visible'
      ? 'Visible page content and typed values are recorded; passwords and hidden fields stay hidden. Nothing is sent until you review it.'
      : 'Page text and inputs are hidden. You review it before it is sent.';
  },
  consentAccept: 'Start recording',
  consentDecline: 'Not now',
  recording: 'Recording',
  stop: 'Stop',
  warningSoon: ({ seconds }) => `${seconds} seconds left`,
  warningFinal: ({ seconds }) => `${seconds} seconds left`,
  reviewTitle: 'Send recording?',
  reviewBody: ({ duration }) => `You recorded ${duration}.`,
  reviewPrivacy: ({ privacy }) => recordedSentence(privacy),
  noteLabel: 'Add a note (optional)',
  send: 'Send recording',
  discard: 'Discard',
  uploading: 'Sending',
  sent: () => 'Recording sent',
  failed: () => "Couldn't send recording",
  startFailed: () => "Couldn't start recording",
  retry: 'Retry',
  openLink: 'Open',
  copyLink: 'Copy link',
  copied: 'Copied',
  copyFailed: "Couldn't copy",
  close: 'Close',
  optionsTitle: 'Recording options',
  optionsSummary: ({ privacy, profile }) => [privacy, profile].filter(Boolean).join(' · '),
  privacyLabel: 'Privacy',
  profileLabel: 'Profile',
  privacyUnavailable: 'Not allowed here',
  privacyMode: ({ mode }) => MODE_NAMES[mode],
  privacyHint: ({ privacy }) => modeHint(privacy),
  networkLabel: 'Network',
  networkBodies: 'Include network request and response content',
  record: 'Record',
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
