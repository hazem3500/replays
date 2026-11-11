// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecorder } from './recorder.ts';
import { RELOAD_FLAG_KEY } from './reload-flag.ts';
import { createFakeRrweb, createFakeTransport } from './testing/fakes.ts';
import type { RecorderOptions, RecorderUi, RecordingChoice } from './types.ts';

const HOST: Pick<RecorderOptions, 'capture' | 'choices' | 'privacy'> = {
  privacy: { sanitize: false, blockMedia: false },
  capture: { performance: true },
  choices: { diagnostics: true, privacy: ['text-masked', 'masked'], remember: false },
};

function uiWith(choice?: RecordingChoice) {
  const consents = vi.fn<RecorderUi['requestConsent']>(() => Promise.resolve(true));
  let stop: (() => void) | undefined;
  const ui: RecorderUi = {
    chooseOptions: () => Promise.resolve(choice),
    requestConsent: consents,
    showIndicator: (context) => {
      stop = context.stop;
      return () => {};
    },
    confirmUpload: () => Promise.resolve({ confirmed: true }),
  };
  return { ui, consents, stop: () => stop?.() };
}

const build = (options: Partial<RecorderOptions>) =>
  createRecorder({ upload: createFakeTransport().upload, loadRrweb: createFakeRrweb().load, activation: () => true, ...HOST, ...options });

const offerOf = async (choices: NonNullable<RecorderOptions['choices']>) => {
  const { recorderChoices } = await import('./recorder-choices.ts');
  const { settingsBuilder } = await import('./recorder-settings.ts');
  const host = { ...HOST, choices };
  return recorderChoices(host, settingsBuilder(host)).offer((privacy) => privacy.facts(1, true))?.fromLoad;
};

async function expectFlagLeftAlone(choices: RecorderOptions['choices']) {
  const flag = JSON.stringify({ exp: Date.now() + 20_000, choice: { privacy: 'visible', performance: true } });
  sessionStorage.setItem(RELOAD_FLAG_KEY, flag);
  const { ui, consents } = uiWith({ privacy: 'masked' });
  const recorder = createRecorder({
    upload: createFakeTransport().upload,
    loadRrweb: createFakeRrweb().load,
    activation: () => true,
    ui,
    privacy: { sanitize: false, blockMedia: false },
    capture: { performance: true },
    ...(choices ? { choices } : {}),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(recorder.getState().status).toBe('idle');
  expect(consents).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toBe(flag);
  void recorder.request();
  await vi.waitFor(() => expect(consents).toHaveBeenCalledOnce());
}

describe('recording from page load', () => {
  afterEach(() => sessionStorage.clear());

  it('saves the flag and reloads instead of recording when the choice asks for it', async () => {
    const reload = vi.fn<() => void>();
    const { ui } = uiWith({ privacy: 'text-masked', performance: true, fromLoad: true });
    const recorder = build({ ui, reload });
    await recorder.request();
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toContain('text-masked');
    expect(recorder.getState().status).not.toBe('recording');
  });

  it('records on this page when the choice does not ask for a reload', async () => {
    const reload = vi.fn<() => void>();
    const { ui, stop } = uiWith({ privacy: 'text-masked', performance: true });
    const recorder = build({ ui, reload });
    const done = recorder.request();
    await vi.waitFor(() => expect(recorder.getState().status).toBe('recording'));
    stop();
    await done;
    expect(reload).not.toHaveBeenCalled();
  });

  it('resumes after the reload with no prompt, marks the bundle, and fires once', async () => {
    sessionStorage.setItem(
      RELOAD_FLAG_KEY,
      JSON.stringify({ exp: Date.now() + 20_000, choice: { privacy: 'text-masked', performance: true } }),
    );
    const transport = createFakeTransport();
    const rrweb = createFakeRrweb();
    const { ui, consents, stop } = uiWith();
    const recorder = createRecorder({ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true, ui, ...HOST });
    await vi.waitFor(() => expect(recorder.getState().status).toBe('recording'));
    expect(consents).not.toHaveBeenCalled();
    rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
    stop();
    await vi.waitFor(() => expect(transport.reports).toHaveLength(1));
    expect(transport.reports[0]?.bundle.meta.captured).toMatchObject({ performance: true, fromLoad: true });
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toBeNull();
  });

  it.each([
    ['a customer recorder', { diagnostics: true, by: 'customer' as const }],
    ['a host that opts out', { diagnostics: true, fromLoad: false, privacy: ['text-masked' as const, 'masked' as const] }],
    ['a recorder without choices', undefined],
  ])('leaves a flag alone and still asks for consent in %s', async (_name, choices) => {
    await expectFlagLeftAlone(choices);
  });

  it('does not reload again after resuming, so there is no loop', async () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, JSON.stringify({ exp: Date.now() + 20_000, choice: { performance: true, fromLoad: true } }));
    const reload = vi.fn<() => void>();
    const recorder = build({ ui: uiWith().ui, reload });
    await vi.waitFor(() => expect(recorder.getState().status).toBe('recording'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a stale flag and starts nothing', async () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, JSON.stringify({ exp: Date.now() - 1, choice: { performance: true } }));
    const recorder = build({ ui: uiWith().ui });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recorder.getState().status).toBe('idle');
  });

  it('offers it to staff by default, and not to a host that opts out or to customers', () => {
    return Promise.all([
      expect(offerOf({ diagnostics: true, privacy: ['text-masked', 'masked'] })).resolves.toBe(true),
      expect(offerOf({ diagnostics: true, fromLoad: false, privacy: ['text-masked', 'masked'] })).resolves.toBeUndefined(),
      expect(offerOf({ diagnostics: true, by: 'customer' })).resolves.toBeUndefined(),
    ]);
  });
});
