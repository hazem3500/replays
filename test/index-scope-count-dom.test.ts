// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RefreshLine, ScopeCount, type ScopeCountState } from '../src/client/index/ScopeCount.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('index result count while lists load', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  function render(props: { replays: number | undefined; suites?: number; shown?: boolean; state: ScopeCountState }) {
    act(() => {
      root.render(createElement(ScopeCount, { shown: true, ...props }));
    });
  }

  const visible = () => host.querySelector('.scope-count-value');
  const status = () => host.querySelector('[role="status"]')?.textContent;

  it('shows a known count at once, with no skeleton', () => {
    render({ replays: 22, suites: 4, state: 'ready' });
    expect(visible()?.querySelectorAll('number-flow-react')).toHaveLength(2);
    expect(host.querySelector('.scope-count-skeleton')).toBeNull();
    expect(status()).toBe('22 replays · 4 suites');
  });

  it('keeps the count it had through a refresh and says so only to screen readers', () => {
    render({ replays: 1, state: 'updating' });
    expect(visible()?.textContent).toMatch(/ replay$/);
    expect(host.querySelector('.scope-count')?.getAttribute('data-state')).toBe('updating');
    expect(host.querySelector('[role="status"]')?.classList.contains('sr-only')).toBe(true);
    expect(status()).toBe('Updating replays…');
  });

  it('holds the place of a count not known yet with a text-height bar', () => {
    render({ replays: undefined, state: 'loading' });
    expect(host.querySelector('.scope-count-skeleton')).not.toBeNull();
    expect(visible()).toBeNull();
    expect(status()).toBe('Loading replays…');
  });

  it('shows neither a count nor a bar after a failed load', () => {
    render({ replays: 3, state: 'error' });
    expect(visible()).toBeNull();
    expect(host.querySelector('.scope-count-skeleton')).toBeNull();
  });

  it('stays for screen readers only while the view is not filtered', () => {
    render({ replays: 5, state: 'ready', shown: false });
    expect(host.querySelector('.scope-count')?.classList.contains('sr-only')).toBe(true);
  });

  it('marks the header hairline active only while a refresh runs', () => {
    act(() => {
      root.render(createElement(RefreshLine, { active: true }));
    });
    expect(host.querySelector('.load-line')?.hasAttribute('data-active')).toBe(true);
    act(() => {
      root.render(createElement(RefreshLine, { active: false }));
    });
    expect(host.querySelector('.load-line')?.hasAttribute('data-active')).toBe(false);
  });
});
