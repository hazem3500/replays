// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecorder } from './recorder.ts';
import { createDefaultUi } from './default-ui.ts';
import { createDeferredUi } from './deferred-ui.ts';
import { blockSelector } from './privacy.ts';
import { createRecorderStore } from './store.ts';
import { createRecordingTimer, recordingTimer } from './timer.ts';
import { formatDurationLong } from './format.ts';
import { createAnnouncer, trapFocus } from './kit/index.ts';
import { composeUi, consentDialog, recordingIndicator, reviewDialog, resultToast } from './ui/index.ts';
import { createFakeRrweb, createFakeTransport, testRecorderUi } from './testing/index.ts';
import type { RecorderOptions, RecorderUi } from './types.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
function setup(options: Partial<RecorderOptions> = {}) {
  const rrweb = createFakeRrweb();
  const transport = createFakeTransport();
  const recorder = createRecorder({
    upload: transport.upload,
    loadRrweb: rrweb.load,
    activation: () => true,
    strictInvariants: false,
    privacy: { consoleLevels: [], captureNetwork: false },
    ...options,
  });
  return { recorder, rrweb, transport };
}
testRecorderUi('default UI contract', createDefaultUi, { describe, it });
testRecorderUi('composed step UI contract', () => composeUi(consentDialog(), recordingIndicator(), reviewDialog(), resultToast()), {
  describe,
  it,
});
describe('recorder kit', () => {
  it('rejects a deliberately broken UI contract', async () => {
    const cases: (() => void | Promise<void>)[] = [];
    testRecorderUi(
      'broken UI',
      () => ({ requestConsent: async () => true, confirmUpload: async () => ({ confirmed: true }), showIndicator: () => () => {} }),
      {
        describe: (_name, run) => run(),
        it: (_name, run) => {
          cases.push(run);
        },
      },
    );
    await expect(cases[0]!()).rejects.toThrow(/assert|dialog|Missing/i);
  });
  it('dismisses every composed step, including a hidden indicator root', () => {
    const ui = composeUi(consentDialog(), recordingIndicator(), reviewDialog(), resultToast());
    const hide = ui.showIndicator({ startedAt: Date.now(), maxDurationMs: 180000, stop: () => {} });
    hide();
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'test' } });
    ui.dismiss?.();
    expect(document.querySelectorAll('[data-recorder-ui]')).toHaveLength(0);
  });
  it('keeps the deprecated explicit default UI pair working through its lazy facade', async () => {
    const compat = await import('./compat.ts');
    const { recorder, rrweb } = setup({ ui: compat.createDefaultUi() });
    const pending = recorder.request();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector('[data-recorder-action="consent-decline"]'),
      ).toBeTruthy(),
    );
    document
      .querySelector('[data-recorder-ui]')!
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-recorder-action="consent-decline"]')!
      .click();
    await pending;
    expect(rrweb.loads).toBe(0);
    recorder.destroy();
    await Promise.resolve();
  });
  it('is headless and requires a UI for request', async () => {
    const { recorder } = setup({ strictInvariants: false });
    await expect(recorder.request()).rejects.toThrow(/createGuidedRecorder/);
    await recorder.start({ consent: true });
    expect(document.querySelector('[data-recorder-ui]')).toBeNull();
    recorder.destroy();
  });
  it('checks activation before loading rrweb and before upload', async () => {
    let active = false;
    const { recorder, rrweb, transport } = setup({ activation: () => active, strictInvariants: true });
    await expect(recorder.start({ consent: true })).rejects.toThrow(/activation/);
    expect(rrweb.loads).toBe(0);
    active = true;
    await recorder.start({ consent: true });
    const stop = document.createElement('button');
    document.body.append(stop);
    recorder.attestStop(stop);
    recorder.stop();
    active = false;
    await expect(recorder.upload({ confirmed: true })).rejects.toThrow(/activation/);
    expect(transport.reports).toHaveLength(0);
    recorder.destroy();
  });
  it('warns once during migration without blocking existing UI', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { recorder } = setup({ activation: () => false, strictInvariants: false });
    try {
      await recorder.start({ consent: true });
      vi.advanceTimersByTime(6000);
      expect(recorder.getState().status).toBe('recording');
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      recorder.destroy();
      warn.mockRestore();
    }
  });
  it('owns the Stop click listener, monitors visibility and discards instead of uploading', async () => {
    vi.useFakeTimers();
    const { recorder, transport } = setup({ strictInvariants: true });
    const stop = document.createElement('button');
    document.body.append(stop);
    await recorder.start({ consent: true });
    recorder.attestStop(stop);
    vi.advanceTimersByTime(1000);
    expect(recorder.getState().status).toBe('recording');
    stop.hidden = true;
    vi.advanceTimersByTime(2000);
    expect(recorder.getState().status).toBe('idle');
    await expect(recorder.upload({ confirmed: true })).rejects.toThrow(/no recording/);
    expect(transport.reports).toHaveLength(0);
    stop.hidden = false;
    await recorder.start({ consent: true });
    recorder.attestStop(stop);
    stop.click();
    expect(recorder.getState().status).toBe('review');
    recorder.destroy();
  });
  it('cannot bypass Stop attestation by stopping before the grace period', async () => {
    const { recorder, transport } = setup({ strictInvariants: true });
    await recorder.start({ consent: true });
    recorder.stop();
    expect(recorder.getState().status).toBe('idle');
    await expect(recorder.upload({ confirmed: true })).rejects.toThrow(/no recording/);
    expect(transport.reports).toHaveLength(0);
    recorder.destroy();
  });
  it('retry preserves the exact reviewed report and throttles upload progress', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const reports: unknown[] = [];
    const { recorder } = setup({
      upload: async (report, { onProgress }) => {
        reports.push(report);
        onProgress?.({ loaded: 40, total: 100 });
        onProgress?.({ loaded: 80, total: 100 });
        if (++attempt === 1) throw new Error('offline');
        return { replayId: 'retry' };
      },
    });
    await recorder.start({ consent: true });
    recorder.stop();
    await expect(recorder.upload({ confirmed: true, note: 'Keep this note' })).rejects.toThrow('offline');
    recorder.setReportContext({ metadata: { changed: true } });
    await recorder.retryUpload();
    expect(reports[1]).toBe(reports[0]);
    recorder.destroy();
  });
  it('throttles transport progress and cancels a queued update on discard', async () => {
    vi.useFakeTimers();
    let send: ((progress: { loaded: number; total?: number }) => void) | undefined;
    let finish: (() => void) | undefined;
    const { recorder } = setup({
      upload: async (_report, context) => {
        send = context.onProgress;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { replayId: 'progress' };
      },
    });
    await recorder.start({ consent: true });
    recorder.stop();
    const upload = recorder.upload({ confirmed: true });
    send?.({ loaded: 40, total: 100 });
    expect(recorder.getState()).toMatchObject({ status: 'uploading', progress: { fraction: 0.4 } });
    send?.({ loaded: 80, total: 100 });
    expect(recorder.getState()).toMatchObject({ progress: { loaded: 40 } });
    vi.advanceTimersByTime(250);
    expect(recorder.getState()).toMatchObject({ progress: { loaded: 80 } });
    send?.({ loaded: 90, total: 100 });
    recorder.discard();
    vi.advanceTimersByTime(250);
    expect(recorder.getState().status).toBe('idle');
    finish?.();
    await expect(upload).rejects.toThrow(/discarded/);
    recorder.destroy();
  });
  it('passes privacy facts to deferred prompts and routes respond actions', async () => {
    const deferred = createDeferredUi();
    const { recorder, rrweb } = setup({ ui: deferred.ui, privacy: { sanitize: false } });
    const result = recorder.request();
    expect(deferred.pending.get()?.kind).toBe('consent');
    expect((deferred.pending.get() as Parameters<RecorderUi['requestConsent']>[0]).privacy?.mode).toBe('visible');
    recorder.respond({ consent: false });
    await result;
    expect(rrweb.loads).toBe(0);
    recorder.destroy();
  });
  it('derives countdown warnings and stops ticking outside recording', async () => {
    vi.useFakeTimers();
    const { recorder } = setup({ strictInvariants: false, maxDurationMs: 60000 });
    const timer = createRecordingTimer(recorder);
    expect(timer.get()).toBeUndefined();
    await recorder.start({ consent: true });
    expect(timer.get()?.label).toBe('0:00');
    vi.advanceTimersByTime(30000);
    expect(timer.get()?.warning).toBe('soon');
    vi.advanceTimersByTime(20000);
    expect(timer.get()?.warning).toBe('final');
    recorder.stop();
    expect(timer.get()).toBeUndefined();
    timer.dispose();
    recorder.destroy();
    expect(formatDurationLong(73000)).toBe('1 minute 13 seconds');
    expect(recordingTimer({ status: 'idle' })).toBeUndefined();
  });
  it('selector subscriptions only notify changes, including multiple subscribers', async () => {
    const { recorder } = setup();
    const store = createRecorderStore(recorder);
    const selection = store.select((s) => s.status);
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const off = selection.subscribe(first);
    const off2 = selection.subscribe(second);
    await recorder.start({ consent: true });
    expect(selection.get()).toBe('recording');
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    off();
    off2();
    recorder.destroy();
  });
  it('validates privacy selectors, offers chat presets and rejects empty entries', () => {
    expect(blockSelector({ presets: ['crisp', 'intercom'], ids: ['private'], attributes: ['data-secret'] })).toContain('#crisp-chatbox');
    expect(() => blockSelector({ selectors: ['[bad='] })).toThrow(/Invalid/);
    expect(() => blockSelector({ selectors: [''] })).toThrow(/Empty/);
  });
  it('deduplicates announcements and restores background inert state', () => {
    const background = document.createElement('button');
    const root = document.createElement('div');
    const first = document.createElement('button');
    const last = document.createElement('button');
    root.append(first, last);
    document.body.append(background, root);
    const release = trapFocus(root);
    expect(background.inert).toBe(true);
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    release();
    expect(background.inert).toBe(false);
    const announcer = createAnnouncer();
    announcer.say('Recording');
    const live = document.querySelector('[role="status"]');
    announcer.say('Recording');
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live?.textContent).toBe('Recording');
    announcer.dispose();
  });
});
