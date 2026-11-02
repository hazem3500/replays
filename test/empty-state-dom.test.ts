// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyState, type EmptyStateProps } from '../src/client/components/ui/empty-state.tsx';
import { type AutoRetry, useAutoRetry } from '../src/client/hooks/use-auto-retry.ts';
import { indexEmptyState } from '../src/client/index/index-empty.tsx';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (props: EmptyStateProps) => act(async () => root.render(createElement(EmptyState, props)));
const state = () => host.querySelector<HTMLElement>('.empty-state')!;

describe('EmptyState', () => {
  it('runs an action’s onSelect when its button is pressed', async () => {
    const onSelect = vi.fn<() => void>();
    await render({ title: 'No replays match these filters', actions: [{ id: 'clear', label: 'Clear filters', primary: true, onSelect }] });
    await act(async () => host.querySelector<HTMLButtonElement>('button[data-action-id="clear"]')!.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('renders an href action as a link that opens external targets in a new tab', async () => {
    await render({
      title: 'No replays yet',
      actions: [{ id: 'docs', label: 'Recorder guide', href: 'https://example.com/guide', external: true }],
    });
    const link = host.querySelector<HTMLAnchorElement>('a[data-action-id="docs"]')!;
    expect([link.getAttribute('href'), link.target]).toEqual(['https://example.com/guide', '_blank']);
  });

  it('lists what narrows the view under an accessible name', async () => {
    await render({ title: 'No replays match these filters', chips: ['Host demo.example', 'Has errors'], chipsLabel: 'Active filters' });
    const list = host.querySelector('ul[aria-label="Active filters"]')!;
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
  const css = readFileSync(join(import.meta.dirname, '../src/client/components/ui/empty-state.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('takes every size and colour outside :root from a custom property', () => {
    const rules = css.slice(css.indexOf('}') + 1);
    const literal = [
      ...rules.matchAll(
        /(?:^|[;{\s])(color|background|font-size|line-height|height|width|padding|gap|column-gap|row-gap|margin|border-radius|max-width|flex):\s*([^;}]+)/g,
      ),
    ]
      .map((match) => `${match[1]}: ${match[2]!.trim()}`)
      .filter((declaration) => !/var\(--|: (?:none|auto|0)$/.test(declaration));
    expect(literal).toEqual([]);
  });

  it('runs the entrance only when reduced motion is not requested', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*{[^{}]*{[^{}]*}\s*}/, '');
    expect(outside).not.toMatch(/animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*{\s*\.empty-state\s*{\s*animation:/);
  });
});

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
  const show = (failing: boolean, pending = false) =>
    act(async () => root.render(createElement(Probe, { failing, pending, retry, report: (next) => (out.current = next) })));
  return { out, show };
}

describe('useAutoRetry', () => {
  it('retries after the first backoff step and counts down to it', async () => {
    vi.useFakeTimers();
    const retry = vi.fn<() => void>();
    const { out, show } = mountRetry(retry);
    await show(true);
    expect(out.current?.secondsLeft).toBe(2);
    await act(async () => vi.advanceTimersByTime(2_000));
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
    await act(async () => vi.advanceTimersByTime(2_000));
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(out.current?.secondsLeft).toBe(5);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it('stops retrying and resets the backoff once the load recovers', async () => {
    vi.useFakeTimers();
    const retry = vi.fn<() => void>();
    const { out, show } = mountRetry(retry);
    await show(true);
    await act(async () => vi.advanceTimersByTime(2_000));
    await show(false);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect([retry.mock.calls.length, out.current?.attempt]).toEqual([1, 0]);
  });

  it('retries at once when the browser comes back online', async () => {
    const retry = vi.fn<() => void>();
    const { show } = mountRetry(retry);
    await show(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('index empty states', () => {
  const retry: AutoRetry = { secondsLeft: 5, attempt: 1, retryNow: () => {} };

  it('a network failure reads as unreachable, with the countdown and a primary Try again', () => {
    const props = indexEmptyState({ kind: 'error', product: 'Replays', connection: true, reason: '', retry });
    expect([props.tone, props.title, props.status, props.actions?.[0]?.primary]).toEqual([
      'offline',
      'Can’t reach the Replays server',
      'Retrying in 5s',
      true,
    ]);
  });

  it('an attempt in flight reads as Retrying… instead of a countdown', () => {
    expect(
      indexEmptyState({ kind: 'error', product: 'Replays', connection: true, reason: '', retry: { ...retry, secondsLeft: undefined } })
        .status,
    ).toBe('Retrying…');
  });

  it('a server error keeps its reason in the body', () => {
    expect(
      indexEmptyState({ kind: 'error', product: 'Replays', connection: false, reason: 'Replays failed to load (500)', retry }).body,
    ).toBe('Replays failed to load (500). This is usually temporary.');
  });

  it('saved results while offline are kept, under a banner', () => {
    expect(indexEmptyState({ kind: 'offline', connection: true, retry })).toMatchObject({ variant: 'banner', title: 'Offline' });
  });

  it('an empty purpose tab names the purpose and its retention', () => {
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

  it('an empty purpose tab leads with upload when the dialog is available', () => {
    const purpose = { id: 'walkthrough', label: 'Walkthroughs', order: 3 };
    const actions = indexEmptyState({ kind: 'purpose', purpose, onShowAll: () => {} }, () => {}).actions ?? [];
    expect(actions.map((action) => [action.id, Boolean(action.primary)])).toEqual([
      ['upload', true],
      ['show-all', false],
    ]);
  });

  it('a search narrowed by other filters offers to search everything', () => {
    const props = indexEmptyState({
      kind: 'search',
      query: 'x',
      narrowing: ['Walkthroughs'],
      onClearSearch: () => {},
      onSearchEverything: () => {},
    });
    expect(props.actions?.map((action) => action.id)).toEqual(['clear-search', 'search-everything']);
  });

  it('a search on its own offers only to clear it', () => {
    const props = indexEmptyState({
      kind: 'search',
      query: 'chekout',
      narrowing: [],
      onClearSearch: () => {},
      onSearchEverything: () => {},
    });
    expect(props.actions?.map((action) => action.id)).toEqual(['clear-search']);
  });

  it('an empty filtered list shows which filters are on', () => {
    expect(indexEmptyState({ kind: 'filtered', active: ['Host demo.example', 'Has errors'], onClearFilters: () => {} }).chips).toEqual([
      'Host demo.example',
      'Has errors',
    ]);
  });
});
