// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { feedTransition } from '../src/client/index/feed-transition.ts';

function cleanUp() {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
}

describe('Feed transition fallbacks', () => {
  afterEach(cleanUp);

  it('applies every rapid layout change in order when the browser has no view transitions', () => {
    const layouts: string[] = [];
    feedTransition(() => layouts.push('grid'), 'poster');
    feedTransition(() => layouts.push('list'), 'poster');
    feedTransition(() => layouts.push('grid'), 'poster');
    expect(layouts).toEqual(['grid', 'list', 'grid']);
    expect(document.querySelector('[style*="view-transition-name"]')).toBeNull();
  });

  it('keeps an open filter dialog live while its underlying results change', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const start = vi.fn<() => void>();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    document.body.innerHTML = '<div role="dialog"><input aria-label="Host" /></div><ul class="feed-list"></ul>';
    const input = document.querySelector('input');
    input?.focus();
    feedTransition(() => document.querySelector('ul')?.append(document.createElement('li')));
    expect(start).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('li')).toHaveLength(1);
  });

  it('applies an instant change (a tab switch) at once, without a page transition', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const start = vi.fn<() => void>();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    document.body.innerHTML = '<ul class="feed-list"><li data-entry-id="a"></li></ul>';
    let seen = -1;
    feedTransition(() => (seen = document.querySelectorAll('li').length), 'instant');
    expect(seen).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.feedTransition).toBeUndefined();
    expect(document.querySelector('[style*="view-transition-name"]')).toBeNull();
  });
});
