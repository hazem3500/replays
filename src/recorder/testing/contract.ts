import assert from 'node:assert/strict';
import { createRecorder } from '../recorder.ts';
import type { PrivacyFacts, RecorderUi, RecordingSummary } from '../types.ts';
import { createFakeRrweb, createFakeTransport } from './fakes.ts';
import { queryDeep } from './query-deep.ts';

type Runner = { describe(name: string, run: () => void): unknown; it(name: string, run: () => void | Promise<void>): unknown };
type Options = {
  controls?: Partial<Record<'accept' | 'decline' | 'stop' | 'send' | 'discard' | 'retry' | 'dismiss' | 'note', string>>;
  render?: (flush: () => Promise<void>) => Promise<void>;
};
const summary: RecordingSummary = {
  durationMs: 73000,
  eventCount: 2,
  consoleErrors: 1,
  failedRequests: 1,
  approxBytes: 200,
  stopReason: 'user',
};
const privacy: PrivacyFacts = {
  mode: 'masked',
  maxDurationMs: 180000,
  reviewRequired: true,
  captures: { pageText: false, inputs: false, media: false, console: true, network: true },
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const consent = (ui: RecorderUi, mode: PrivacyFacts['mode'] = 'masked') =>
  ui.requestConsent({
    trigger: { source: 'user' },
    maxDurationMs: 180000,
    privacy: { ...privacy, mode, captures: { ...privacy.captures, pageText: mode === 'visible', inputs: mode === 'visible' } },
    signal: new AbortController().signal,
  });

const defaultSelectors = {
  accept: '[data-recorder-action="consent-accept"]',
  decline: '[data-recorder-action="consent-decline"]',
  stop: '[data-recorder-action="stop"]',
  send: '[data-recorder-action="send"]',
  discard: '[data-recorder-action="discard"]',
  retry: '[data-recorder-action="retry"]',
  dismiss: '[data-recorder-action="dismiss"]',
  note: '[data-recorder-field="note"]',
};

/** Runner-agnostic DOM contract. Mount framework UIs in factory and flush with options.render. */
export function testRecorderUi(name: string, factory: () => RecorderUi, runner: Runner, options: Options = {}): void {
  const selectors = { ...defaultSelectors, ...options.controls };
  const render = async () => {
    if (options.render) await options.render(flush);
    else await flush();
  };
  const control = (key: keyof typeof selectors) => {
    const element = queryDeep<HTMLElement>(selectors[key]);
    assert.ok(element, `Missing ${key} control`);
    return element;
  };
  const test = (title: string, run: (ui: RecorderUi) => Promise<void>) =>
    runner.it(title, async () => {
      const ui = factory();
      try {
        await run(ui);
      } finally {
        ui.dismiss?.();
      }
    });
  runner.describe(name, () => {
    for (const [title, run] of contractCases) test(title, (ui) => run(ui, { control, render, selectors }));
  });
}

type ContractContext = {
  control: (key: keyof typeof defaultSelectors) => HTMLElement;
  render: () => Promise<void>;
  selectors: typeof defaultSelectors;
};
async function acceptConsent(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  try {
    const pending = consent(ui);
    await render();
    const dialog = queryDeep('[role="dialog"], [role="alertdialog"]');
    assert.ok(dialog);
    assert.ok(
      Boolean(dialog.getAttribute('aria-label')) || Boolean(dialog.getAttribute('aria-labelledby')),
      'Dialog needs an accessible name',
    );
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    assert.notEqual(active, control('accept'), 'Accept must not have initial focus');
    control('accept').click();
    assert.equal(await pending, true);
    await render();
    assert.equal(document.activeElement, opener);
  } finally {
    opener.remove();
  }
}

async function declineConsent(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  let pending = consent(ui);
  await render();
  control('decline').click();
  assert.equal(await pending, false);
  pending = consent(ui);
  await render();
  queryDeep('[role="dialog"], [role="alertdialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(await pending, false);
}

async function abortConsent(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { render } = context;
  const abort = new AbortController();
  const pending = ui.requestConsent({ trigger: { source: 'user' }, maxDurationMs: 180000, privacy, signal: abort.signal });
  await render();
  abort.abort();
  assert.equal(await pending, false);
  await render();
  assert.equal(queryDeep('[role="dialog"], [role="alertdialog"]'), null);
}

async function reflectPrivacy(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  const masked = consent(ui);
  await render();
  const text = queryDeep('[role="dialog"]')?.textContent;
  control('decline').click();
  await masked;
  const visible = consent(ui, 'visible');
  await render();
  assert.notEqual(queryDeep('[role="dialog"]')?.textContent, text);
  control('decline').click();
  await visible;
}

async function attestIndicator(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render, selectors } = context;
  let attested: Element | undefined;
  let stops = 0;
  const hide = ui.showIndicator({
    startedAt: Date.now(),
    maxDurationMs: 180000,
    stop: () => {
      stops++;
    },
    attestStop(element) {
      attested = element;
      return () => {};
    },
  });
  try {
    await render();
    const stop = control('stop');
    assert.equal(attested, stop);
    assert.ok(stop.isConnected && !stop.hidden);
    const root = stop.getRootNode();
    assert.ok(Boolean(stop.closest('[data-recorder-ui]')) || (root instanceof ShadowRoot && root.host.hasAttribute('data-recorder-ui')));
    stop.click();
    assert.equal(stops, 1);
  } finally {
    hide();
  }
  await render();
  const stop = queryDeep<HTMLElement>(selectors.stop);
  assert.ok(!stop || stop.hidden || stop.closest('[hidden]'));
}

async function reviewRecording(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  let pending = ui.confirmUpload({ summary, signal: new AbortController().signal });
  await render();
  const note = control('note');
  assert.ok(note instanceof HTMLTextAreaElement, 'Note must be a textarea');
  note.value = 'Example note';
  note.dispatchEvent(new Event('input', { bubbles: true }));
  control('send').click();
  assert.deepEqual(await pending, { confirmed: true, note: 'Example note' });
  pending = ui.confirmUpload({ summary, signal: new AbortController().signal });
  await render();
  control('discard').click();
  assert.deepEqual(await pending, { confirmed: false });
  const abort = new AbortController();
  pending = ui.confirmUpload({ summary, signal: abort.signal });
  await render();
  abort.abort();
  assert.deepEqual(await pending, { confirmed: false });
}

async function showResult(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  assert.ok(typeof ui.showResult === 'function' && typeof ui.dismiss === 'function', 'Result and dismiss must be implemented');
  ui.showResult({ status: 'uploaded', receipt: { replayId: 'test' } });
  await render();
  assert.ok(queryDeep('[role="status"], [aria-live]')?.textContent);
  let retries = 0;
  ui.showResult({
    status: 'error',
    error: new Error('Technical detail'),
    retry: () => {
      retries++;
    },
  });
  await render();
  control('retry').click();
  assert.equal(retries, 1);
  control('dismiss').click();
  await render();
  assert.equal(queryDeep('[data-recorder-ui]'), null);
}

async function recordFlow(ui: RecorderUi, context: ContractContext): Promise<void> {
  const { control, render } = context;
  const rrweb = createFakeRrweb();
  const transport = createFakeTransport();
  const recorder = createRecorder({
    ui,
    upload: transport.upload,
    loadRrweb: rrweb.load,
    activation: () => true,
    strictInvariants: true,
    indicatorGraceMs: 100,
    privacy: { consoleLevels: [], captureNetwork: false },
  });
  try {
    const result = recorder.request();
    await render();
    assert.equal(rrweb.loads, 0);
    control('accept').click();
    await render();
    assert.equal(recorder.getState().status, 'recording');
    control('stop').click();
    await render();
    assert.equal(transport.reports.length, 0);
    control('send').click();
    await result;
    assert.equal(transport.reports.length, 1);
    const next = recorder.request();
    await render();
    control('accept').click();
    await render();
    control('stop').hidden = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(recorder.getState().status, 'idle');
    await next;
    assert.equal(transport.reports.length, 1);
  } finally {
    recorder.destroy();
  }
}

const contractCases: [string, (ui: RecorderUi, context: ContractContext) => Promise<void>][] = [
  ['consent has a named dialog, safe initial focus, accepts and returns focus', acceptConsent],
  ['decline and Escape refuse consent', declineConsent],
  ['abort closes consent and removes its dialog', abortConsent],
  ['visible capture changes privacy copy', reflectPrivacy],
  ['indicator has a visible, blocked and attested Stop control', attestIndicator],
  ['review sends the note and discards or aborts', reviewRecording],
  ['result announces success, exposes one Retry and dismisses', showResult],
  ['full flow waits for Accept and Send and discards when Stop disappears', recordFlow],
];
