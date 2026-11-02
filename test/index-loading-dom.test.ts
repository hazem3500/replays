// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedSkeleton, skeletonCount } from '../src/client/index/FeedSkeleton.tsx';
import { knownShape, rememberShape } from '../src/client/index/index-cache.ts';
import { ScopeCount } from '../src/client/index/ScopeCount.tsx';

// why: NumberFlow draws its digits as custom elements, which happy-dom (the browser boundary here) does not implement.
vi.mock('@number-flow/react', () => ({ default: ({ value }: { value: number }) => createElement('span', null, String(value)) }));

function viewport(width: number, height: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** A fresh React root per test, with a clean tab (sessionStorage), and a lookup that fails loudly. */
function mountPoint() {
  const mount: { host: HTMLDivElement; root?: Root } = { host: document.createElement('div') };
  beforeEach(() => {
    sessionStorage.clear();
    mount.host = document.createElement('div');
    document.body.append(mount.host);
    mount.root = createRoot(mount.host);
  });
  afterEach(() => {
    act(() => mount.root?.unmount());
    mount.host.remove();
  });
  return {
    render: (element: ReactElement) => act(() => mount.root?.render(element)),
    query: (selector: string) => mount.host.querySelector<HTMLElement>(selector),
    find: (selector: string) => {
      const element = mount.host.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`${selector} is not rendered`);
      return element;
    },
  };
}

describe('pending feed', () => {
  const dom = mountPoint();

  it('draws the count the view showed last time, never more than the viewport holds', () => {
    viewport(1280, 800);
    expect(skeletonCount('grid', 1)).toBe(1);
    expect(skeletonCount('list', 3)).toBe(3);
    expect(skeletonCount('list', 0)).toBe(0);
    // why: 800 px tall fits 8 list rows of 85 px below a 120 px header, and 2 rows of four 289 px grid cards.
    expect(skeletonCount('list', 50)).toBe(8);
    expect(skeletonCount('grid', 50)).toBe(8);
  });

  it('defaults to one grid row or five list rows when the count is unknown', () => {
    viewport(1280, 800);
    expect(skeletonCount('grid')).toBe(4);
    expect(skeletonCount('list')).toBe(5);
    viewport(390, 844);
    expect(skeletonCount('grid')).toBe(1);
    viewport(1280, 300);
    expect(skeletonCount('list')).toBe(3);
  });

  it('renders the real feed pending, with no poster requests, and nothing for a known empty view', () => {
    viewport(1280, 800);
    dom.render(createElement(FeedSkeleton, { view: 'list', known: { count: 2, leadingSuite: false } }));
    const pending = dom.find('.feed-pending');
    expect(pending.hasAttribute('inert')).toBe(true);
    expect(pending.querySelectorAll('.feed-list .feed-item.feed-session')).toHaveLength(2);
    expect(pending.querySelector('.feed-title .feed-title-text')).not.toBeNull();
    expect(pending.querySelector('.poster img')).toBeNull();
    dom.render(createElement(FeedSkeleton, { key: 'empty', view: 'list', known: { count: 0, leadingSuite: false } }));
    expect(dom.query('.feed-pending')).toBeNull();
  });

  it('remembers each view’s shape for the rest of the tab', () => {
    expect(knownShape('?errors=1||')).toBeUndefined();
    rememberShape('?errors=1||', { count: 1, leadingSuite: true });
    expect(JSON.parse(sessionStorage.getItem('replays-index-counts') ?? '[]')).toEqual([['?errors=1||', { count: 1, leadingSuite: true }]]);
    expect(knownShape('?errors=1||')).toEqual({ count: 1, leadingSuite: true });
  });
});

describe('scope count', () => {
  const dom = mountPoint();

  it('keeps the count on screen while refreshing and says it only to screen readers', () => {
    dom.render(createElement(ScopeCount, { replays: 22, suites: 4, shown: true, state: 'updating' }));
    const count = dom.find('.scope-count');
    expect(count.dataset.state).toBe('updating');
    expect(count.querySelector('.scope-count-value')).not.toBeNull();
    expect(count.querySelector('[role="status"]')?.textContent).toBe('Updating replays…');
    expect(count.querySelector('[role="status"]')?.className).toContain('sr-only');

    dom.render(createElement(ScopeCount, { replays: 1, suites: 0, shown: true, state: 'ready' }));
    expect(count.querySelector('[role="status"]')?.textContent).toBe('1 replay');
  });

  it('holds the count’s place with a bar during the first load', () => {
    dom.render(createElement(ScopeCount, { replays: undefined, shown: true, state: 'loading' }));
    expect(dom.query('.scope-count-skeleton')).not.toBeNull();
    expect(dom.query('[role="status"]')?.textContent).toBe('Loading replays…');
  });
});
