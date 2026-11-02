// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandSearch } from '../src/client/index/IndexHeader.tsx';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('mobile command search controls', () => {
  it('keeps focus when Escape clears and offers a touch close action that clears and blurs', async () => {
    const onChange = vi.fn<(value: string) => void>();
    await act(async () =>
      root.render(createElement(CommandSearch, { value: 'demo', onChange, entries: undefined, total: undefined, compact: true })),
    );
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => input.focus());
    expect(host.querySelector('[aria-label="Close search"]')).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onChange).toHaveBeenCalledWith('');

    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!;
    await act(async () => close.click());
    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).not.toBe(input);
    expect(host.querySelector('input[type="search"]')).toBe(input);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('input[type="search"]')).toBe(input);
  });
});
