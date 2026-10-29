// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandSearch } from '../src/client/index/IndexHeader.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLElement;
let root: Root;

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected the element to be rendered');
  return value;
}

function renderSearch(compact: boolean) {
  const onChange = vi.fn<(value: string) => void>();
  act(() => {
    root.render(createElement(CommandSearch, { value: 'demo', onChange, entries: undefined, total: undefined, compact }));
  });
  const input = required(host.querySelector<HTMLInputElement>('input[type="search"]'));
  return { input, onChange, close: () => host.querySelector<HTMLButtonElement>('[aria-label="Close search"]') };
}

function run(action: () => void) {
  act(() => {
    action();
  });
}

const press = (target: EventTarget, key: string) =>
  run(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

describe('phone command search', () => {
  beforeEach(() => {
    host = document.createElement('header');
    host.className = 'app-topbar';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it('offers a close action only while the field is entered on phones', () => {
    const { input, close } = renderSearch(true);
    expect(close()).toBeNull();
    run(() => input.focus());
    expect(close()).not.toBeNull();
  });

  it('clears the query and leaves the field when the close action is tapped', () => {
    const { input, onChange, close } = renderSearch(true);
    run(() => input.focus());
    run(() => required(close()).click());
    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).not.toBe(input);
  });

  it('keeps the same field after closing, so the shortcut reopens it', () => {
    const { input, close } = renderSearch(true);
    run(() => input.focus());
    run(() => required(close()).click());
    press(document.body, '/');
    expect(document.activeElement).toBe(input);
  });

  it('closes the results on the first Escape and clears the query on the second, keeping focus', () => {
    const { input, onChange } = renderSearch(true);
    run(() => input.focus());
    press(input, 'Escape');
    expect(onChange).not.toHaveBeenCalled();
    press(input, 'Escape');
    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(input);
  });

  it('publishes where its slot rests in the top bar on phones', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const slot = this.classList.contains('command-search');
      return new DOMRect(slot ? 250 : 10, slot ? 16 : 10, 40, 40);
    });
    renderSearch(true);
    const slot = required(host.querySelector<HTMLElement>('.command-search'));
    expect(slot.style.getPropertyValue('--rest-x')).toBe('240px');
    expect(slot.style.getPropertyValue('--rest-y')).toBe('6px');
  });

  it('leaves the desktop field unmeasured and without a close action', () => {
    const { input, close } = renderSearch(false);
    run(() => input.focus());
    expect(close()).toBeNull();
    expect(required(host.querySelector<HTMLElement>('.command-search')).style.getPropertyValue('--rest-x')).toBe('');
  });
});
