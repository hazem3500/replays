// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { createRecorderFormat, defaultRecorderMessages, recordingTimer, resolveRecorderMessages, selectError } from './index.ts';
import { createDefaultUi } from './ui/index.ts';
import type { PrivacyFacts, RecorderState, RecordingSummary } from './types.ts';
import { must } from './testing.ts';

const summary: RecordingSummary = {
  durationMs: 73000,
  eventCount: 3,
  consoleErrors: 1,
  failedRequests: 0,
  approxBytes: 1_500_000,
  stopReason: 'user',
};
const reviewText = async (ui: ReturnType<typeof createDefaultUi>) => {
  const abort = new AbortController();
  const decision = ui.confirmUpload({ summary, signal: abort.signal });
  const text = must(document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector('p')).textContent;
  abort.abort();
  await decision;
  return text;
};

afterEach(() => {
  document.body.innerHTML = '';
});

it('fills legacy template overrides from the message params', () => {
  const messages = resolveRecorderMessages({ consentBody: 'Up to {minutes} min {missing}', sent: 'Saved {reference}' });
  expect(messages.consentBody({ minutes: 3, maxDurationMs: 180000, limit: '3 minutes' })).toBe('Up to 3 min {missing}');
  expect(messages.sent({ reference: 'ABC', receipt: { replayId: 'id' } })).toBe('Saved ABC');
});

it('keeps defaults for keys an override leaves out and drops the retired openReplay', () => {
  const messages = resolveRecorderMessages({ consentTitle: 'Record?', openReplay: 'Open' });
  expect(messages.consentTitle).toBe('Record?');
  expect(messages.stop).toBe(defaultRecorderMessages.stop);
  expect(Object.keys(messages)).not.toContain('openReplay');
});

it('writes default English without em or en dashes', () => {
  const error = new Error('x');
  const facts: PrivacyFacts = {
    mode: 'visible',
    maxDurationMs: 1,
    reviewRequired: false,
    captures: { pageText: true, inputs: true, media: true, console: true, network: true },
  };
  const copy = [
    ...Object.values(defaultRecorderMessages).filter((value) => typeof value === 'string'),
    defaultRecorderMessages.consentBody({ minutes: 3, maxDurationMs: 180000, limit: '3 minutes' }),
    defaultRecorderMessages.consentPrivacy({ mode: 'masked' }),
    defaultRecorderMessages.consentPrivacy({ mode: 'visible' }),
    defaultRecorderMessages.consentPrivacy({ mode: 'visible', privacy: facts }),
    defaultRecorderMessages.consentPrivacy({
      mode: 'masked',
      privacy: { ...facts, reviewRequired: true, captures: { ...facts.captures, pageText: false, inputs: false, media: false } },
    }),
    defaultRecorderMessages.warningSoon({ seconds: 30 }),
    defaultRecorderMessages.warningFinal({ seconds: 10 }),
    defaultRecorderMessages.reviewBody({ summary, duration: '1 minute', size: '1 MB' }),
    defaultRecorderMessages.sent({ reference: 'r', receipt: { replayId: 'r' } }),
    defaultRecorderMessages.failed({ error, canRetry: true }),
    defaultRecorderMessages.startFailed({ error }),
  ];
  expect(copy.filter((text) => /[–—]/.test(text))).toEqual([]);
});

it('words store errors with the given messages unless the error carries a userMessage', () => {
  const messages = { failed: 'Upload broke', startFailed: () => 'Start broke' };
  const error = new Error('Backend 502');
  expect(selectError({ status: 'error', phase: 'upload', error, summary }, messages)?.message).toBe('Upload broke');
  expect(selectError({ status: 'error', phase: 'start', error }, messages)?.message).toBe('Start broke');
  expect(selectError({ status: 'error', phase: 'start', error }, undefined)?.message).toBe("Couldn't start recording");
  const hosted = Object.assign(new Error('x'), { userMessage: 'Sign in again' });
  expect(selectError({ status: 'error', phase: 'upload', error: hosted }, messages)?.message).toBe('Sign in again');
});

it('labels the recording timer with the format.elapsed hook', () => {
  const state: RecorderState = { status: 'recording', trigger: { source: 'user' }, startedAt: 0, maxDurationMs: 60000 };
  const snapshot = recordingTimer(state, 5000, { format: { elapsed: (ms) => `${ms / 1000}s` } });
  expect([snapshot?.label, snapshot?.remainingLabel]).toEqual(['5s', '55s']);
});

it('formats sizes, durations and the clock in the given locale', () => {
  const english = createRecorderFormat();
  const german = createRecorderFormat('de');
  expect([english.bytes(512), english.bytes(1_500_000), german.bytes(1_500_000)]).toEqual(['512 byte', '1.5 MB', '1,5 MB']);
  expect([english.duration(73000), german.duration(73000)]).toEqual(['1 minute 13 seconds', '1 Minute 13 Sekunden']);
  expect(createRecorderFormat('ar-EG').elapsed(65000)).toBe('١:٠٥');
});

it('passes formatted duration and size to the review message', async () => {
  const ui = createDefaultUi({
    format: { duration: () => 'D', bytes: () => 'B' },
    messages: { reviewBody: ({ duration, size, summary: facts }) => `${duration} ${size} ${facts.eventCount}` },
  });
  expect(await reviewText(ui)).toBe('D B 3');
});

it('writes the review duration in words in the given locale by default', async () => {
  expect(await reviewText(createDefaultUi())).toBe('Duration: 1 minute 13 seconds.');
  expect(await reviewText(createDefaultUi({ locale: 'de', messages: { reviewBody: '{duration}' } }))).toBe('1 Minute 13 Sekunden');
});
