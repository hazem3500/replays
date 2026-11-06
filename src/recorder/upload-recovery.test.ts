// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultUi } from './default-ui.ts';
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
afterEach(() => {
  document.body.innerHTML = '';
});

it('retries once after recovery and ignores duplicate clicks', async () => {
  const wait = deferred();
  const run = vi.fn(() => wait.promise);
  const retry = vi.fn();
  const ui = createDefaultUi();
  ui.showResult({
    status: 'error',
    error: Object.assign(new Error('secret'), { action: { label: 'Sign in', pendingLabel: 'Waiting', run } }),
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

it('keeps retry and recovery available after failure without showing technical details', async () => {
  const wait = deferred();
  const retry = vi.fn();
  const ui = createDefaultUi();
  ui.showResult({
    status: 'error',
    error: Object.assign(new Error('secret'), { action: { label: 'Sign in', run: () => wait.promise } }),
    retry,
  });
  control('recover').click();
  wait.reject(Object.assign(new Error('private exception'), { userMessage: 'Please allow the popup and try again' }));
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
  const retry = vi.fn();
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
