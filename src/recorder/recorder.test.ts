// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { must } from './testing.ts';
import { createDefaultUi } from './default-ui.ts';
import { createRecorder, MASK_INPUT_OPTIONS } from './recorder.ts';
import type { RecorderOptions, RecorderUi, RrwebModule, UploadDecision } from './types.ts';
import type { IssueReportUpload } from './upload.ts';

function fakeRrweb() {
  const stop = vi.fn<() => void>();
  let emit: ((event: Record<string, unknown>) => void) | undefined;
  let options: Record<string, unknown> | undefined;
  const module: RrwebModule = {
    record: (recordOptions) => {
      options = recordOptions;
      const send = recordOptions.emit as (event: Record<string, unknown>) => void;
      emit = send;
      send({
        type: 4,
        timestamp: Date.now(),
        data: { href: location.href, width: 800, height: 600 },
      });
      send({ type: 2, timestamp: Date.now(), data: { node: {} } });
      return stop;
    },
  };
  return {
    module,
    load: vi.fn<() => Promise<RrwebModule>>(() => Promise.resolve(module)),
    stop,
    emit: (event: Record<string, unknown>) => emit?.(event),
    options: () => must(options, 'record options'),
  };
}

function fakeUi(overrides: Partial<RecorderUi> = {}) {
  const hide = vi.fn<() => void>();
  let stop: (() => void) | undefined;
  const ui: RecorderUi = {
    requestConsent: vi.fn<RecorderUi['requestConsent']>(() => Promise.resolve(true)),
    showIndicator: vi.fn<RecorderUi['showIndicator']>((context: { stop: () => void }) => {
      stop = context.stop;
      return hide;
    }),
    confirmUpload: vi.fn<RecorderUi['confirmUpload']>((): Promise<UploadDecision> =>
      Promise.resolve({ confirmed: true, note: 'It broke' }),
    ),
    showResult: vi.fn<NonNullable<RecorderUi['showResult']>>(),
    ...overrides,
  };
  return { ui, hide, clickStop: () => stop?.() };
}

function setup(overrides: Partial<RecorderOptions> = {}) {
  const rrweb = fakeRrweb();
  const ui = fakeUi();
  const upload = vi.fn<IssueReportUpload>(() => Promise.resolve({ replayId: 'issue-1' }));
  const recorder = createRecorder({
    upload,
    ui: ui.ui,
    loadRrweb: rrweb.load,
    app: { name: 'Example app' },
    ...overrides,
  });
  return { recorder, rrweb, ui, upload };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('createRecorder', () => {
  it('aborts pending upload recovery when destroyed and never uploads after late success', async () => {
    const wait = deferred<void>();
    let signal: AbortSignal | undefined;
    const upload = vi.fn<IssueReportUpload>(() =>
      Promise.reject(
        Object.assign(new Error('private'), {
          action: {
            label: 'Sign in',
            run: (context: { signal: AbortSignal }) => {
              signal = context.signal;
              return wait.promise;
            },
          },
        }),
      ),
    );
    const recorder = setup({ upload, ui: createDefaultUi() }).recorder;
    const done = recorder.request({ source: 'user' });
    await flush();
    must(
      document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector<HTMLButtonElement>('[data-recorder-action=consent-accept]'),
    ).click();
    await flush();
    recorder.stop();
    await flush();
    must(
      [...document.querySelectorAll('[data-recorder-ui]')].flatMap((host) => [
        ...(host.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-recorder-action=send]') ?? []),
      ])[0],
    ).click();
    await done;
    const recover = [...document.querySelectorAll('[data-recorder-ui]')].flatMap((host) => [
      ...(host.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-recorder-action=recover]') ?? []),
    ])[0];
    must(recover).click();
    recorder.destroy();
    expect(signal?.aborted).toBe(true);
    wait.resolve();
    await flush();
    expect(upload).toHaveBeenCalledOnce();
    document.querySelectorAll('[data-recorder-ui]').forEach((host) => host.remove());
  });
  it('loads nothing and records nothing until consent', async () => {
    const { recorder, rrweb, upload } = setup({
      ui: fakeUi({ requestConsent: vi.fn<RecorderUi['requestConsent']>(() => Promise.resolve(false)) }).ui,
    });
    expect(rrweb.load).not.toHaveBeenCalled();
    await expect(recorder.request()).resolves.toBeUndefined();
    expect(rrweb.load).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(recorder.getState()).toEqual({ status: 'idle' });
  });

  it('refuses to start or upload without explicit flags', async () => {
    const { recorder } = setup();
    await expect(recorder.start({} as unknown as { consent: true })).rejects.toThrow(/consent/);
    await expect(recorder.upload({} as unknown as { confirmed: true })).rejects.toThrow(/confirmation/);
  });

  it('records with masking, shows the indicator, and uploads after review', async () => {
    const { recorder, rrweb, ui, upload } = setup();
    const done = recorder.request({ source: 'user' });
    await flush();
    expect(recorder.getState().status).toBe('recording');
    expect(ui.ui.showIndicator).toHaveBeenCalledOnce();

    const options = rrweb.options();
    expect(options).toMatchObject({
      maskAllInputs: true,
      maskInputOptions: MASK_INPUT_OPTIONS,
      maskTextSelector: '*',
      recordCanvas: false,
      inlineImages: false,
      collectFonts: false,
    });
    expect(options.blockSelector).toContain('[data-recorder-ui]');
    expect(options.blockSelector).toContain('img');
    const maskTextFn = options.maskTextFn as (t: string, e: HTMLElement | null) => string;
    expect(maskTextFn('Secret name', document.body)).toBe('****** ****');
    const maskInputFn = options.maskInputFn as (t: string) => string;
    expect(maskInputFn('my secret')).toBe('*********');

    rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
    ui.clickStop();
    const receipt = await done;

    expect(rrweb.stop).toHaveBeenCalledOnce();
    expect(ui.hide).toHaveBeenCalledOnce();
    expect(ui.ui.confirmUpload).toHaveBeenCalledOnce();
    expect(receipt).toEqual({ replayId: 'issue-1' });
    expect(upload).toHaveBeenCalledOnce();
    const [report] = upload.mock.calls[0] as unknown as [
      {
        bundle: { meta: { source: string }; steps: { kind: string }[] };
        note: string;
        app: unknown;
      },
    ];
    expect(report.note).toBe('It broke');
    expect(report.app).toEqual({ name: 'Example app' });
    expect(report.bundle.meta.source).toBe('human');
    expect(report.bundle.steps.map((step) => step.kind)).toEqual(['start', 'stop']);
    expect(recorder.getState()).toEqual({ status: 'uploaded', receipt });
  });

  it('supports explicit unsanitized capture without unmasking passwords or hidden fields', async () => {
    const { recorder, rrweb } = setup({ privacy: { sanitize: false } });
    await recorder.start({ consent: true });
    const options = rrweb.options();
    expect(options.maskAllInputs).toBe(false);
    expect(options.maskInputOptions).toEqual({ password: true, hidden: true });
    expect(options.maskTextSelector).toBeUndefined();
    recorder.destroy();
  });

  it('keeps unmasked text only inside the unmask selector', async () => {
    const { recorder, rrweb } = setup({
      privacy: { unmaskTextSelector: '[data-public]' },
    });
    await recorder.start({ consent: true });
    const fn = rrweb.options().maskTextFn as (t: string, e: HTMLElement | null) => string;
    const nav = document.createElement('nav');
    nav.setAttribute('data-public', '');
    const label = document.createElement('span');
    nav.append(label);
    expect(fn('Projects', label)).toBe('Projects');
    expect(fn('Projects', document.createElement('span'))).toBe('********');
    recorder.discard();
  });

  it('throws on an invalid privacy selector instead of blocking nothing', () => {
    expect(() => setup({ privacy: { blockSelector: '[data-private=' } })).toThrow(/privacy\.blockSelector is not a valid CSS selector/);
    expect(() => setup({ privacy: { unmaskTextSelector: 'nav[' } })).toThrow(/privacy\.unmaskTextSelector/);
  });

  it('closes the consent dialog when destroyed while it is open', async () => {
    const { recorder } = setup({ ui: createDefaultUi() });
    const request = recorder.request();
    expect(document.querySelector('[data-recorder-ui]')).not.toBeNull();
    recorder.destroy();
    await expect(request).resolves.toBeUndefined();
    expect(document.querySelector('[data-recorder-ui]')).toBeNull();
    expect(recorder.getState()).toEqual({ status: 'idle' });
  });

  it('closes the review dialog when discarded while it is open', async () => {
    const { recorder, upload } = setup({ ui: createDefaultUi() });
    const request = recorder.request();
    must(
      document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector<HTMLButtonElement>('button.primary'),
      'Start recording',
    ).click();
    await flush();
    recorder.stop();
    await flush();
    expect([...document.querySelectorAll('[data-recorder-ui]')].map((host) => host.shadowRoot?.textContent).join(' ')).toContain(
      'Send recording?',
    );
    recorder.discard();
    await expect(request).resolves.toBeUndefined();
    await vi.waitFor(() => expect(document.querySelector('[data-recorder-ui]')).toBeNull());
    expect(upload).not.toHaveBeenCalled();
  });

  it('discards when the user declines the upload', async () => {
    const ui = fakeUi({
      confirmUpload: vi.fn<RecorderUi['confirmUpload']>((): Promise<UploadDecision> => Promise.resolve({ confirmed: false })),
    });
    const { recorder, upload } = setup({ ui: ui.ui });
    const done = recorder.request();
    await flush();
    ui.clickStop();
    await expect(done).resolves.toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
    expect(recorder.getState()).toEqual({ status: 'idle' });
  });

  it('stops at the duration cap and still asks before uploading', async () => {
    vi.useFakeTimers();
    try {
      const { recorder } = setup({ maxDurationMs: 10_000 });
      await recorder.start({ consent: true });
      vi.advanceTimersByTime(10_000);
      expect(recorder.getState()).toMatchObject({
        status: 'review',
        summary: { stopReason: 'max-duration' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops at the size cap', async () => {
    const { recorder, rrweb } = setup({ maxBytes: 2_000 });
    await recorder.start({ consent: true });
    rrweb.emit({
      type: 3,
      timestamp: Date.now(),
      data: { text: 'x'.repeat(3_000) },
    });
    await flush();
    expect(recorder.getState()).toMatchObject({
      status: 'review',
      summary: { stopReason: 'max-size' },
    });
  });

  it('drops the recording when the page is hidden', async () => {
    const { recorder, upload } = setup();
    await recorder.start({ consent: true });
    window.dispatchEvent(new Event('pagehide'));
    expect(recorder.getState()).toEqual({ status: 'idle' });
    await expect(recorder.upload({ confirmed: true })).rejects.toThrow('There is no recording to upload');
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps the recording after a failed upload so the user can retry', async () => {
    const upload = vi.fn<IssueReportUpload>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ replayId: 'issue-2' });
    const { recorder, ui } = setup({ upload });
    const done = recorder.request();
    await flush();
    ui.clickStop();
    await expect(done).resolves.toBeUndefined();
    const failure = vi.mocked(must(ui.ui.showResult, 'showResult')).mock.calls.at(-1)?.[0];
    if (!failure || failure.status !== 'error') throw new Error('Expected upload failure');
    must(failure.retry, 'retry')();
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]?.[0]).toEqual(upload.mock.calls[1]?.[0]);
    expect(ui.ui.confirmUpload).toHaveBeenCalledTimes(1);
    expect(ui.ui.requestConsent).toHaveBeenCalledTimes(1);
    expect(ui.ui.showResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('ignores a second request while one is running', async () => {
    const { recorder, ui } = setup();
    const first = recorder.request();
    await flush();
    await expect(recorder.request()).resolves.toBeUndefined();
    ui.clickStop();
    await first;
  });

  it('restores fetch and console after stopping', async () => {
    const fetchBefore = globalThis.fetch;
    const errorBefore = console.error;
    const { recorder } = setup();
    await recorder.start({ consent: true });
    expect(globalThis.fetch).not.toBe(fetchBefore);
    recorder.stop();
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(console.error).toBe(errorBefore);
  });

  describe('one-click flow (prompts off)', () => {
    const quick = { prompts: { consent: false, review: false } };

    it('records without a consent dialog and uploads when the user finishes', async () => {
      const { recorder, rrweb, ui, upload } = setup(quick);
      const done = recorder.request();
      await flush();
      expect(ui.ui.requestConsent).not.toHaveBeenCalled();
      expect(recorder.getState().status).toBe('recording');

      rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
      ui.clickStop();
      await expect(done).resolves.toEqual({ replayId: 'issue-1' });
      expect(ui.ui.confirmUpload).not.toHaveBeenCalled();
      expect(upload).toHaveBeenCalledOnce();
      expect(ui.ui.showResult).toHaveBeenCalledWith({
        status: 'uploaded',
        receipt: { replayId: 'issue-1' },
      });
    });

    it('shows the uploading state while it sends', async () => {
      const hideUploading = vi.fn<() => void>();
      const showUploading = vi.fn<() => () => void>(() => hideUploading);
      const ui = fakeUi({ showUploading });
      const { recorder, rrweb } = setup({ ...quick, ui: ui.ui });
      const done = recorder.request();
      await flush();
      rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
      ui.clickStop();
      await done;
      expect(showUploading).toHaveBeenCalledOnce();
      expect(hideUploading).toHaveBeenCalledOnce();
    });

    it('offers a retry when the upload fails, and keeps the recording for it', async () => {
      const upload = vi
        .fn<IssueReportUpload>()
        .mockRejectedValueOnce(new Error('Sign in first'))
        .mockResolvedValueOnce({ replayId: 'issue-2' });
      const { recorder, rrweb, ui } = setup({ ...quick, upload });
      const done = recorder.request();
      await flush();
      rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
      ui.clickStop();
      await expect(done).resolves.toBeUndefined();
      expect(recorder.getState()).toMatchObject({
        status: 'error',
        phase: 'upload',
      });
      const failure = vi.mocked(must(ui.ui.showResult, 'showResult')).mock.calls.at(-1)?.[0] as {
        status: string;
        error: Error;
        retry?: () => void;
      };
      expect(failure.status).toBe('error');
      expect(failure.error.message).toBe('Sign in first');
      must(failure.retry, 'retry')();
      await flush();
      await flush();
      expect(upload).toHaveBeenCalledTimes(2);
      expect(recorder.getState()).toEqual({
        status: 'uploaded',
        receipt: { replayId: 'issue-2' },
      });
    });

    it('drops a failed upload when the user records again', async () => {
      const upload = vi.fn<IssueReportUpload>().mockRejectedValue(new Error('down'));
      const { recorder, rrweb, ui } = setup({ ...quick, upload });
      const first = recorder.request();
      await flush();
      rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
      ui.clickStop();
      await first;
      void recorder.request();
      await flush();
      expect(recorder.getState().status).toBe('recording');
      recorder.discard();
    });

    it.each(['resolve', 'reject'] as const)('does not let an old %s touch a new recording', async (completion) => {
      const pending = deferred<{ replayId: string }>();
      const upload = vi.fn<IssueReportUpload>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ replayId: 'new' });
      const oldHide = vi.fn<() => void>();
      const nextHide = vi.fn<() => void>();
      const showUploading = vi.fn<() => () => void>().mockReturnValueOnce(oldHide).mockReturnValueOnce(nextHide);
      const ui = fakeUi({ showUploading });
      const { recorder, rrweb } = setup({ ...quick, ui: ui.ui, upload });
      const oldRequest = recorder.request();
      await flush();
      rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
      ui.clickStop();
      await flush();
      recorder.discard();
      const newRequest = recorder.request();
      await flush();
      expect(recorder.getState().status).toBe('recording');

      if (completion === 'resolve') pending.resolve({ replayId: 'old' });
      else pending.reject(new Error('old failure'));
      await oldRequest;
      await flush();
      expect(recorder.getState().status).toBe('recording');
      expect(oldHide).not.toHaveBeenCalled();
      expect(ui.ui.showResult).not.toHaveBeenCalled();
      // why: the current session still owns its indicator and can stop normally.
      ui.clickStop();
      await newRequest;
      expect(recorder.getState().status).toBe('uploaded');
      expect(nextHide).toHaveBeenCalledOnce();
    });

    it('ignores stale consent resolution while a newer consent prompt owns state', async () => {
      const firstConsent = deferred<boolean>();
      const secondConsent = deferred<boolean>();
      const requestConsent = vi
        .fn<RecorderUi['requestConsent']>()
        .mockReturnValueOnce(firstConsent.promise)
        .mockReturnValueOnce(secondConsent.promise);
      const ui = fakeUi({ requestConsent });
      const { recorder } = setup({ ui: ui.ui });
      const oldRequest = recorder.request();
      await flush();
      recorder.discard();
      const newRequest = recorder.request();
      await flush();
      expect(recorder.getState().status).toBe('consent');
      firstConsent.resolve(true);
      await oldRequest;
      expect(recorder.getState().status).toBe('consent');
      secondConsent.resolve(false);
      await newRequest;
      expect(recorder.getState().status).toBe('idle');
    });
  });
});
