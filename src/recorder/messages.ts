/** Recorder UI copy. Every string can be replaced (e.g. for translations). */
export type RecorderMessages = {
  consentTitle: string;
  /** `{minutes}` is replaced with the time limit. */
  consentBody: string;
  consentPrivacy: string;
  consentAccept: string;
  consentDecline: string;
  recording: string;
  stop: string;
  reviewTitle: string;
  /** `{duration}` is replaced with the recording length. */
  reviewBody: string;
  noteLabel: string;
  send: string;
  discard: string;
  /** `{reference}` is replaced with the replay id. */
  sent: string;
  failed: string;
  close: string;
  /** Shown while the recording uploads. */
  uploading: string;
  /** Link to the replay, when the transport returns one. */
  openReplay: string;
  retry: string;
  copied?: string;
  copyFailed?: string;
  copyLink?: string;
  warningSoon?: string;
  warningFinal?: string;
};

export const DEFAULT_MESSAGES: RecorderMessages = {
  consentTitle: 'Record this tab?',
  consentBody: 'Up to {minutes} minutes. Stop whenever you like.',
  consentPrivacy: 'Page text and inputs are masked. Review before sending.',
  consentAccept: 'Start recording',
  consentDecline: 'Not now',
  recording: 'Recording',
  stop: 'Stop',
  reviewTitle: 'Send recording?',
  reviewBody: 'Duration: {duration}.',
  noteLabel: 'Add a note (optional)',
  send: 'Send recording',
  discard: 'Discard',
  sent: 'Recording sent',
  failed: "Couldn't send recording",
  close: 'Close',
  uploading: 'Sending…',
  openReplay: 'Open replay',
  retry: 'Retry',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  copyLink: 'Copy link',
  warningSoon: '30 seconds left',
  warningFinal: '10 seconds left',
};
