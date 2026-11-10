// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultUi } from './default-ui.ts';
import { createRecorder } from './recorder.ts';
import { createFakeRrweb } from './testing/fakes.ts';
import type { IssueReportUpload } from './upload.ts';
import { must } from './testing.ts';

const control = (name: string) =>
  must(document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-recorder-action=${name}]`));
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe('upload recovery', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a link beside a recovery action, and a link-only error on its own', () => {
    const ui = createDefaultUi();
    const link = { label: 'Sign in', url: 'https://example.com/sign-in' };
    ui.showResult({
      status: 'error',
      error: Object.assign(new Error('private'), {
        link,
        action: { label: 'Sign in', run: async () => {} },
      }),
    });
    expect(control('recover').textContent).toBe('Sign in');
    const beside = document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector('a');
    expect(beside?.href).toBe(link.url);
    ui.showResult({ status: 'error', error: Object.assign(new Error('private'), { link }) });
    const anchor = document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector('a');
    expect(anchor?.textContent).toBe('Sign in');
    expect(anchor?.href).toBe(link.url);
    ui.dismiss();
  });

  it('retries once after recovery and ignores duplicate clicks', async () => {
    const wait = deferred();
    const run = vi.fn<() => Promise<void>>(() => wait.promise);
    const retry = vi.fn<() => void>();
    const ui = createDefaultUi();
    ui.showResult({
      status: 'error',
      error: Object.assign(new Error('secret'), {
        action: { label: 'Sign in', pendingLabel: 'Waiting', run },
      }),
      retry,
    });
    const button = control('recover');
    button.click();
    button.dispatchEvent(new MouseEvent('click'));
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Waiting');
    expect(run).toHaveBeenCalledOnce();
    wait.resolve();
    await wait.promise;
    expect(retry).toHaveBeenCalledOnce();
    button.dispatchEvent(new MouseEvent('click'));
    expect(run).toHaveBeenCalledOnce();
    ui.dismiss();
  });
});

describe('recovery failure and cancellation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps retry and recovery available after failure without showing technical details', async () => {
    const wait = deferred();
    const retry = vi.fn<() => void>();
    const ui = createDefaultUi();
    ui.showResult({
      status: 'error',
      error: Object.assign(new Error('secret'), {
        action: { label: 'Sign in', run: () => wait.promise },
      }),
      retry,
    });
    control('recover').click();
    wait.reject(
      Object.assign(new Error('private exception'), {
        userMessage: 'Please allow the popup and try again',
      }),
    );
    await wait.promise.catch(() => {});
    expect(control('recover').disabled).toBe(false);
    expect(document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector('.message')?.textContent).toBe(
      'Please allow the popup and try again',
    );
    expect(document.querySelector('[data-recorder-ui]')?.shadowRoot?.textContent).not.toContain('private exception');
    control('retry').click();
    expect(retry).toHaveBeenCalledOnce();
    ui.dismiss();
  });

  it.each(['dismiss', 'replace'] as const)('aborts recovery on %s and prevents a late retry', async (operation) => {
    const wait = deferred();
    let signal: AbortSignal | undefined;
    const retry = vi.fn<() => void>();
    const ui = createDefaultUi();
    ui.showResult({
      status: 'error',
      error: Object.assign(new Error('secret'), {
        action: {
          label: 'Sign in',
          run: (context: { signal: AbortSignal }) => {
            signal = context.signal;
            return wait.promise;
          },
        },
      }),
      retry,
    });
    control('recover').click();
    if (operation === 'dismiss') ui.dismiss();
    else ui.showUploading();
    expect(signal?.aborted).toBe(true);
    wait.resolve();
    await wait.promise;
    expect(retry).not.toHaveBeenCalled();
    ui.dismiss();
  });
});

describe('recorder recovery destruction', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('aborts pending upload recovery when destroyed and never uploads after late success', async () => {
    const wait = deferred();
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
    const recorder = createRecorder({
      upload,
      ui: createDefaultUi(),
      loadRrweb: createFakeRrweb().load,
      app: { name: 'Example' },
    });
    const done = recorder.request({ source: 'user' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    must(
      document.querySelector('[data-recorder-ui]')?.shadowRoot?.querySelector<HTMLButtonElement>('[data-recorder-action=consent-accept]'),
    ).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upload).toHaveBeenCalledOnce();
    for (const host of document.querySelectorAll('[data-recorder-ui]')) host.remove();
  });
});
