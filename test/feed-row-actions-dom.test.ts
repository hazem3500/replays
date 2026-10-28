// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Feed, type FeedEntry } from '../src/client/index/Feed.tsx';
import { type ReplaySummary, summarizeReplay } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DAY = 86_400_000;

function session(id: string, extra: Partial<ReplaySummary> = {}): FeedEntry {
  const summary: ReplaySummary = { ...summarizeReplay(replay(id)), title: `Replay ${id}`, ...extra };
  return { kind: 'session', id, summary };
}

describe('feed row actions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const kept = { kept: { by: 'me', at: new Date().toISOString() }, expiresAt: null };
    const respond = (init?: RequestInit) => Response.json(init?.method === 'PUT' ? kept : { expiresAt: null });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => Promise.resolve(respond(init))),
    );
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(entries: FeedEntry[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const feed = createElement(Feed, { entries, view: 'list', grouped: false, query: '' });
    act(() => {
      root.render(createElement(QueryClientProvider, { client }, feed));
    });
  }

  it('says when a replay expires within a week, with the full date as its tooltip, and offers Keep', () => {
    const expiresAt = new Date(Date.now() + 2.5 * DAY).toISOString();
    render([session('soon', { expiresAt })]);
    const hint = host.querySelector('.feed-expiry time');
    expect(hint?.textContent).toBe('Expires in 3 days');
    expect(hint?.getAttribute('dateTime')).toBe(expiresAt);
    expect(hint?.getAttribute('title')).toMatch(/^Expires /);
    expect(host.querySelector('.feed-keep')?.getAttribute('aria-label')).toBe('Keep Replay soon');
  });

  it('shows nothing for replays that are kept, never expire or expire later', () => {
    const kept = { by: 'a-user', at: new Date().toISOString() };
    render([
      session('later', { expiresAt: new Date(Date.now() + 30 * DAY).toISOString() }),
      session('never', { expiresAt: null }),
      session('kept', { expiresAt: new Date(Date.now() + DAY).toISOString(), kept }),
    ]);
    expect(host.querySelector('.feed-expiry')).toBeNull();
  });
});
