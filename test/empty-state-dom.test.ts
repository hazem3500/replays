// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyState, type EmptyStateProps } from '../src/client/components/ui/empty-state.tsx';
import { type AutoRetry, useAutoRetry } from '../src/client/hooks/use-auto-retry.ts';
import { type IndexEmptyInput, indexEmptyState } from '../src/client/index/index-empty.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;

function present<T extends Element>(element: T | null) {
  if (!element) throw new Error('expected the element to be rendered');
  return element;
}

const render = (props: EmptyStateProps) => settle(() => root.render(createElement(EmptyState, props)));
const state = () => present(host.querySelector<HTMLElement>('.empty-state'));

const SCHEDULE = [2_000, 5_000];

function Probe({
  failing,
  pending,
  retry,
  report,
}: {
  failing: boolean;
  pending: boolean;
  retry: () => void;
  report: (state: AutoRetry) => void;
}) {
  report(useAutoRetry({ failing, pending, retry, schedule: SCHEDULE }));
  return null;
}

function mountRetry(retry: () => void) {
  const out: { current?: AutoRetry } = {};
  const report = (next: AutoRetry) => {
    out.current = next;
  };
  const show = (failing: boolean, pending = false) => settle(() => root.render(createElement(Probe, { failing, pending, retry, report })));
  return { out, show };
}

const css = readFileSync(join(import.meta.dirname, '../src/client/components/ui/empty-state.css'), 'utf8').replaceAll(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const retrying: AutoRetry = { secondsLeft: 5, attempt: 1, retryNow: () => {} };
const search = { kind: 'search', onClearSearch: () => {}, onSearchEverything: () => {} } as const;

function mountHost() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

async function unmountHost() {
  await settle(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

describe('EmptyState', () => {
  beforeEach(mountHost);
  afterEach(unmountHost);

  it('runs an action’s onSelect when its button is pressed', async () => {
    const onSelect = vi.fn<() => void>();
    await render({ title: 'No replays match these filters', actions: [{ id: 'clear', label: 'Clear filters', primary: true, onSelect }] });
    const button = present(host.querySelector<HTMLButtonElement>('button[data-action-id="clear"]'));
    await settle(() => button.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('renders an href action as a link that opens external targets in a new tab', async () => {
    await render({
      title: 'No replays yet',
      actions: [{ id: 'docs', label: 'Recorder guide', href: 'https://example.com/guide', external: true }],
    });
    const link = present(host.querySelector<HTMLAnchorElement>('a[data-action-id="docs"]'));
    expect([link.getAttribute('href'), link.target]).toEqual(['https://example.com/guide', '_blank']);
  });

  it('lists what narrows the view under an accessible name', async () => {
    await render({
      title: 'No replays match these filters',
      details: { chips: { label: 'Active filters', items: ['Host demo.example', 'Has errors'] } },
    });
    const list = present(host.querySelector('ul[aria-label="Active filters"]'));
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Host demo.example', 'Has errors']);
  });

  it('announces an error as an alert', async () => {
    await render({ title: 'Can’t reach the server', tone: 'error' });
    expect(state().getAttribute('role')).toBe('alert');
  });

  it('reports offline politely and leaves a plain empty state unannounced', async () => {
    await render({ title: 'Offline', tone: 'offline', variant: 'banner' });
    expect(state().getAttribute('role')).toBe('status');
    await render({ title: 'Nothing here' });
    expect(state().getAttribute('role')).toBeNull();
  });

  it('renders no icon when the icon is null', async () => {
    await render({ title: 'No requests', icon: null, variant: 'compact' });
    expect(host.querySelector('.empty-state-icon')).toBeNull();
  });
});

describe('empty-state.css', () => {
  it('takes every size and colour outside :root from a custom property', () => {
    const rules = css.slice(css.indexOf('}') + 1);
    const declarations = rules.matchAll(
      /(?:^|[;{\s])(color|background|font-size|line-height|height|width|padding|gap|column-gap|row-gap|margin|border-radius|max-width|flex):\s*([^;}]+)/g,
    );
    const literal = [...declarations]
      .map(([, property, value]) => `${property}: ${value?.trim()}`)
      .filter((declaration) => !/var\(--|: (?:none|auto|0)$/.test(declaration));
    expect(literal).toEqual([]);
  });

  it('runs the entrance only when reduced motion is not requested', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*{[^{}]*{[^{}]*}\s*}/, '');
    expect(outside).not.toMatch(/animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*{\s*\.empty-state\s*{\s*animation:/);
  });
});

describe('useAutoRetry', () => {
  beforeEach(mountHost);
  afterEach(unmountHost);

  it('retries after the first backoff step and counts down to it', async () => {
    vi.useFakeTimers();
    const retry = vi.fn<() => void>();
    const { out, show } = mountRetry(retry);
    await show(true);
    expect(out.current?.secondsLeft).toBe(2);
    await settle(() => vi.advanceTimersByTime(2_000));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('pauses the countdown while an attempt is in flight', async () => {
    vi.useFakeTimers();
    const { out, show } = mountRetry(vi.fn<() => void>());
    await show(true, true);
    expect(out.current?.secondsLeft).toBeUndefined();
  });

  it('repeats the last backoff step once the schedule runs out', async () => {
    vi.useFakeTimers();
    const retry = vi.fn<() => void>();
    const { out, show } = mountRetry(retry);
    await show(true);
    await settle(() => vi.advanceTimersByTime(2_000));
    await settle(() => vi.advanceTimersByTime(5_000));
    expect(out.current?.secondsLeft).toBe(5);
    await settle(() => vi.advanceTimersByTime(5_000));
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it('stops retrying and resets the backoff once the load recovers', async () => {
    vi.useFakeTimers();
    const retry = vi.fn<() => void>();
    const { out, show } = mountRetry(retry);
    await show(true);
    await settle(() => vi.advanceTimersByTime(2_000));
    await show(false);
    await settle(() => vi.advanceTimersByTime(60_000));
    expect([retry.mock.calls.length, out.current?.attempt]).toEqual([1, 0]);
  });

  it('retries at once when the browser comes back online', async () => {
    const retry = vi.fn<() => void>();
    const { show } = mountRetry(retry);
    await show(true);
    await settle(() => window.dispatchEvent(new Event('online')));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('index empty states', () => {
  it('reads a network failure as unreachable, with the countdown and a primary Try again', () => {
    const props = indexEmptyState({ kind: 'error', product: 'Replays', connection: true, reason: '', retry: retrying });
    expect([props.tone, props.title, props.details?.status, props.actions?.[0]?.primary]).toEqual([
      'offline',
      'Can’t reach the Replays server',
      'Retrying in 5s',
      true,
    ]);
  });

  it('reads an attempt in flight as Retrying… instead of a countdown', () => {
    const retry = { ...retrying, secondsLeft: undefined };
    expect(indexEmptyState({ kind: 'error', product: 'Replays', connection: true, reason: '', retry }).details?.status).toBe('Retrying…');
  });

  it('keeps a server error’s reason in the body', () => {
    const reason = 'Replays failed to load (500)';
    expect(indexEmptyState({ kind: 'error', product: 'Replays', connection: false, reason, retry: retrying }).body).toBe(
      'Replays failed to load (500). This is usually temporary.',
    );
  });

  it('keeps saved results while offline, under a banner', () => {
    expect(indexEmptyState({ kind: 'offline', connection: true, retry: retrying })).toMatchObject({ variant: 'banner', title: 'Offline' });
  });

  it('names the purpose and its retention on an empty purpose tab', () => {
    const props = indexEmptyState({
      kind: 'purpose',
      purpose: { id: 'walkthrough', label: 'Walkthroughs', order: 3, retentionDays: 30 },
      onShowAll: () => {},
    });
    expect([props.title, props.body]).toEqual([
      'No walkthroughs yet',
      'Replays uploaded or recorded as Walkthroughs are listed here. Each is kept 30 days.',
    ]);
  });

  it('leads an empty purpose tab with upload when the dialog is available', () => {
    const purpose = { id: 'walkthrough', label: 'Walkthroughs', order: 3 };
    const actions = indexEmptyState({ kind: 'purpose', purpose, onShowAll: () => {} }, () => {}).actions ?? [];
    expect(actions.map((action) => [action.id, Boolean(action.primary)])).toEqual([
      ['upload', true],
      ['show-all', false],
    ]);
  });

  it('offers to search everything when other filters narrow a search', () => {
    const input: IndexEmptyInput = { ...search, query: 'x', narrowing: ['Walkthroughs'] };
    expect(indexEmptyState(input).actions?.map((action) => action.id)).toEqual(['clear-search', 'search-everything']);
  });

  it('offers only to clear a search on its own', () => {
    const input: IndexEmptyInput = { ...search, query: 'chekout', narrowing: [] };
    expect(indexEmptyState(input).actions?.map((action) => action.id)).toEqual(['clear-search']);
  });

  it('shows which filters are on when filtering leaves nothing', () => {
    const props = indexEmptyState({ kind: 'filtered', active: ['Host demo.example', 'Has errors'], onClearFilters: () => {} });
    expect(props.details?.chips?.items).toEqual(['Host demo.example', 'Has errors']);
  });
});
