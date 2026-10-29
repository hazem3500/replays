// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeUi,
  consentDialog,
  createDefaultUi,
  defaultRecorderMessages,
  recordingIndicator,
  resultToast,
  reviewDialog,
  type DefaultUiOptions,
  type RecorderMessages,
} from './ui/index.ts';
import type { PrivacyFacts, RecorderUi, RecordingSummary } from './types.ts';
import { must } from './testing.ts';

const mark = (key: string) => `«${key}»`;
const sentinels: RecorderMessages = {
  consentTitle: mark('consentTitle'),
  consentBody: () => mark('consentBody'),
  consentPrivacy: () => mark('consentPrivacy'),
  consentAccept: mark('consentAccept'),
  consentDecline: mark('consentDecline'),
  recording: mark('recording'),
  stop: mark('stop'),
  warningSoon: () => mark('warningSoon'),
  warningFinal: () => mark('warningFinal'),
  reviewTitle: mark('reviewTitle'),
  reviewBody: () => mark('reviewBody'),
  noteLabel: mark('noteLabel'),
  send: mark('send'),
  discard: mark('discard'),
  uploading: mark('uploading'),
  sent: () => mark('sent'),
  failed: () => mark('failed'),
  startFailed: () => mark('startFailed'),
  retry: mark('retry'),
  copyLink: mark('copyLink'),
  copied: mark('copied'),
  copyFailed: mark('copyFailed'),
  close: mark('close'),
};
const options: DefaultUiOptions = {
  messages: sentinels,
  format: { elapsed: () => mark('format.elapsed'), duration: () => mark('format.duration'), bytes: () => mark('format.bytes') },
};
const privacy: PrivacyFacts = {
  mode: 'masked',
  maxDurationMs: 180000,
  reviewRequired: true,
  captures: { pageText: false, inputs: false, media: false, console: true, network: true },
};
const summary: RecordingSummary = {
  durationMs: 73000,
  eventCount: 3,
  consoleErrors: 1,
  failedRequests: 0,
  approxBytes: 1_500_000,
  stopReason: 'user',
};
const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext'];
const SENTINEL = /«([^»]+)»/g;

function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'STYLE') return '';
  return [...node.childNodes].map(textOf).join('');
}

/** Rendered text and accessible strings, minus sentinels: anything left did not come from `messages` or `format`. */
function leftovers(seen: Set<string>): string[] {
  const strings: string[] = [];
  for (const host of document.querySelectorAll('[data-recorder-ui]')) {
    const root = host.shadowRoot ?? host;
    strings.push(textOf(root));
    for (const element of root.querySelectorAll('*')) for (const name of ATTRIBUTES) strings.push(element.getAttribute(name) ?? '');
  }
  for (const value of strings) for (const [, key] of value.matchAll(SENTINEL)) seen.add(must(key));
  return strings.map((value) => value.replace(SENTINEL, '').trim()).filter(Boolean);
}

const surfaceAction = (selector: string) =>
  must(
    [...document.querySelectorAll('[data-recorder-ui]')].map((host) => host.shadowRoot?.querySelector<HTMLElement>(selector)).find(Boolean),
    selector,
  );
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function prompts(ui: RecorderUi, check: () => void) {
  for (const facts of [privacy, undefined]) {
    const abort = new AbortController();
    const answer = ui.requestConsent({
      trigger: { source: 'user' },
      maxDurationMs: 180000,
      ...(facts ? { privacy: facts } : {}),
      signal: abort.signal,
    });
    check();
    abort.abort();
    await answer;
  }
  const abort = new AbortController();
  const decision = ui.confirmUpload({ summary, signal: abort.signal });
  check();
  abort.abort();
  await decision;
}

function indicator(ui: RecorderUi, check: () => void) {
  vi.useFakeTimers();
  const hide = ui.showIndicator({ startedAt: Date.now(), maxDurationMs: 35_000, stop: () => {} });
  check();
  vi.advanceTimersByTime(5_000);
  check();
  vi.advanceTimersByTime(20_000);
  check();
  hide();
  vi.useRealTimers();
}

async function results(ui: RecorderUi, check: () => void) {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  ui.showUploading?.();
  check();
  for (let attempt = 0; attempt < 2; attempt++) {
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'private-id', url: 'https://example.com/r/private-id' } });
    check();
    surfaceAction('[data-action=copy-link]').click();
    await flush();
    check();
  }
  ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'private-id' } });
  check();
  ui.showResult?.({ status: 'error', error: new Error('Backend 502'), retry: () => {} });
  check();
  ui.showResult?.({ status: 'error', error: new Error('Backend 502') });
  check();
  ui.dismiss?.();
}

async function walk(ui: RecorderUi) {
  const seen = new Set<string>();
  const check = () => expect(leftovers(seen)).toEqual([]);
  await prompts(ui, check);
  indicator(ui, check);
  await results(ui, check);
  return [...seen].sort();
}

const rendered = [...Object.keys(defaultRecorderMessages).filter((key) => key !== 'startFailed'), 'format.elapsed'].sort();

describe('recorder messages coverage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders nothing but overridden messages in every state of the default UI', async () => {
    expect(await walk(createDefaultUi(options))).toEqual(rendered);
  });

  it('renders nothing but overridden messages in every state of the composed kit steps', async () => {
    const ui = composeUi(consentDialog(options), recordingIndicator(options), reviewDialog(options), resultToast(options));
    expect(await walk(ui)).toEqual(rendered);
  });

  it('accepts an override for exactly the keys that have defaults', () => {
    expect(Object.keys(sentinels).sort()).toEqual(Object.keys(defaultRecorderMessages).sort());
  });

  it('writes the consent time limit in words by default', async () => {
    const seen = new Set<string>();
    const abort = new AbortController();
    const answer = createDefaultUi().requestConsent({ trigger: { source: 'user' }, maxDurationMs: 180000, signal: abort.signal });
    expect(leftovers(seen).join(' ')).toContain('Up to 3 minutes. Stop whenever you like.');
    abort.abort();
    await answer;
  });
});
