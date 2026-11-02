// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultUi, formatDuration } from './default-ui.ts';
import { must } from './testing.ts';
const root = () => must(document.querySelector('[data-recorder-ui]')?.shadowRoot);
const node = <T extends Element = HTMLElement>(selector: string) => must(root().querySelector<T>(selector));
const press = (label: string) =>
  must([...root().querySelectorAll('button')].find((n) => n.textContent === label || n.getAttribute('aria-label') === label)).click();
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});
describe('default recorder surface', () => {
  it('keeps the same floating shell across recording, upload and completion', () => {
    const ui = createDefaultUi();
    const stop = vi.fn<() => void>();
    const hide = ui.showIndicator({ startedAt: Date.now(), maxDurationMs: 600000, stop });
    const shell = node('.pill');
    expect(node('[role=status]').textContent).toBe('Recording');
    expect(node('.time').textContent).toBe('0:00');
    expect(node('.recording-label').textContent).toBe('Recording');
    press('Stop');
    expect(stop).toHaveBeenCalledOnce();
    hide();
    const hideUpload = ui.showUploading?.();
    expect(root().querySelector('button')).toBeNull();
    expect(node('progress').hasAttribute('value')).toBe(false);
    expect(node('.pill')).toBe(shell);
    expect(shell.getAttribute('data-phase')).toBe('uploading');
    hideUpload?.();
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'internal-id' } });
    expect(node('.pill')).toBe(shell);
    expect(shell.textContent).toContain('Recording sent');
    expect(shell.textContent).not.toContain('internal-id');
    expect(root().querySelectorAll('[role=status]')).toHaveLength(1);
    ui.dismiss?.();
    expect(document.querySelector('[data-recorder-ui]')).toBeNull();
  });
  it('uses tabular fixed-width time and announces the final warning once', () => {
    vi.useFakeTimers();
    const ui = createDefaultUi();
    ui.showIndicator({
      startedAt: Date.now() - 599000,
      maxDurationMs: 600000,
      stop: vi.fn<() => void>(),
    });
    expect(node('.time').textContent).toBe('9:59');
    vi.advanceTimersByTime(1000);
    expect(node('.time').textContent).toBe('10:00');
    expect(node('[role=status]').textContent).toBe('10 seconds left');
    expect(node('style').textContent).toContain('tabular-nums');
    expect(node('style').textContent).toContain('prefers-reduced-motion: no-preference');
    ui.dismiss?.();
  });
  it('preserves focus on the keyed shell when the Stop control disappears', () => {
    const ui = createDefaultUi();
    ui.showIndicator({ startedAt: Date.now(), maxDurationMs: 600000, stop: vi.fn<() => void>() });
    node<HTMLButtonElement>('button').focus();
    ui.showUploading?.();
    expect(root().activeElement).toBe(node('.pill'));
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'a' } });
    expect(root().activeElement).toBe(node('.pill'));
    ui.dismiss?.();
  });
  it('composes short copy and link/custom actions without exposing absent URLs', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const custom = vi.fn<() => void>();
    const ui = createDefaultUi({
      completion: {
        message: (receipt) => `Saved ${receipt.reference}`,
        actions: [
          { id: 'copy', kind: 'copy', label: 'Copy', value: (receipt) => receipt.reference ?? '' },
          { id: 'custom', kind: 'custom', label: 'Done', onAction: custom },
        ],
      },
    });
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'private', reference: 'ABC' } });
    expect(node('.message').textContent).toBe('Saved ABC');
    expect(root().querySelector('a')).toBeNull();
    press('Copy');
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ABC');
    expect(node('[data-action=copy]').textContent).toBe('Copied');
    expect(root().querySelector('.copy-feedback')).toBeNull();
    press('Done');
    expect(custom).toHaveBeenCalledOnce();
    ui.dismiss?.();
  });
  it('only renders http(s) links supplied by transport or host', () => {
    const ui = createDefaultUi();
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'a', url: 'javascript:alert(1)' } });
    expect(root().querySelector('a')).toBeNull();
    ui.showResult?.({
      status: 'uploaded',
      receipt: { replayId: 'a', url: 'https://example.com/r/a' },
    });
    expect(node('[data-action=copy-link]').textContent).toBe('Copy link');
    expect(root().querySelector('a')).toBeNull();
    ui.dismiss?.();
  });
  it('offers a useful default link copy and no default internal reference action', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const ui = createDefaultUi();
    ui.showResult?.({
      status: 'uploaded',
      receipt: { replayId: 'private', reference: 'internal-reference' },
    });
    expect(root().querySelector('[data-action]')).toBeNull();
    ui.showResult?.({
      status: 'uploaded',
      receipt: { replayId: 'private', url: 'https://example.com/replay' },
    });
    press('Copy link');
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://example.com/replay');
    expect(node('[data-action=copy-link]').textContent).toBe('Copied');
    expect(node('.pill').textContent).not.toContain('Copy link');
    ui.dismiss?.();
  });
  it('cleans a custom renderer when transitioning or dismissing', () => {
    const cleanup = vi.fn<() => void>();
    const ui = createDefaultUi({
      completion: {
        render: (container, context) => {
          container.textContent = context.result.reference ?? 'Saved';
          return cleanup;
        },
      },
    });
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'a' } });
    ui.showUploading?.();
    expect(cleanup).toHaveBeenCalledOnce();
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'a' } });
    ui.dismiss?.();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it('keeps upload errors and retry on the same compact surface', () => {
    const retry = vi.fn<() => void>();
    const ui = createDefaultUi();
    ui.showUploading?.();
    const shell = node('.pill');
    ui.showResult?.({
      status: 'error',
      error: Object.assign(new Error('Secret backend 502'), { userMessage: 'Try again.' }),
      retry,
    });
    expect(node('.pill')).toBe(shell);
    expect(shell.textContent).toContain('Try again.');
    expect(shell.textContent).not.toContain('Secret');
    press('Retry');
    expect(retry).toHaveBeenCalledOnce();
    ui.dismiss?.();
  });
  it('requires consent and closes on abort', async () => {
    const ui = createDefaultUi();
    const abort = new AbortController();
    const decision = ui.requestConsent({
      trigger: { source: 'user' },
      maxDurationMs: 180000,
      signal: abort.signal,
    });
    expect(node('[role=dialog]').getAttribute('aria-modal')).toBe('true');
    expect(root().activeElement?.textContent).toBe('Not now');
    abort.abort();
    await expect(decision).resolves.toBe(false);
    expect(document.querySelector('[data-recorder-ui]')).toBeNull();
  });
  it('supports explicit light theme and host overrides', () => {
    const ui = createDefaultUi({
      theme: { background: 'pink', primary: 'blue' },
      completion: { actions: [] },
    });
    ui.showResult?.({ status: 'uploaded', receipt: { replayId: 'a' } });
    expect((root().host as HTMLElement).style.getPropertyValue('--recorder-background')).toBe('pink');
    ui.dismiss?.();
    expect(formatDuration(125400)).toBe('2:05');
  });
});
