// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpiredReplays } from '../src/client/index/ExpiredReplays.tsx';
import type { ExpiredReplays as ExpiredReplaysBody } from '../src/shared/expired.ts';
import { settle } from './settle.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const body: ExpiredReplaysBody = {
  days: 30,
  records: [
    {
      id: 'checkout',
      title: 'Checkout with a declined card',
      host: 'shop.example',
      capturedAt: '2026-07-20T10:00:00.000Z',
      expiredAt: '2026-10-20T10:00:00.000Z',
      retentionDays: 90,
      profile: 'triage',
    },
    {
      id: 'signup',
      title: 'Signup form validation',
      host: 'app.example',
      capturedAt: '2026-09-01T10:00:00.000Z',
      expiredAt: '2026-10-01T10:00:00.000Z',
      retentionDays: 30,
    },
  ],
};

/** The query's fetch, the response body and the state update each take a task. */
async function flush() {
  for (let turn = 0; turn < 4; turn++) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

const profiles = [{ id: 'triage', label: 'Triage', order: 0, retentionDays: 90 }];

describe('expired replays below the feed', () => {
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
    vi.unstubAllGlobals();
  });

  async function render(response: unknown, filter: { query?: string; profile?: string } = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json(response))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const section = createElement(ExpiredReplays, { query: filter.query ?? '', profile: filter.profile, profiles });
    await settle(() => root.render(createElement(QueryClientProvider, { client }, section)));
    await flush();
  }

  const toggle = () => host.querySelector<HTMLButtonElement>('.expired-toggle');

  it('says how many replays expired recently and keeps them folded', async () => {
    await render(body);
    expect(host.querySelector('.expired-summary')?.textContent).toBe('2 replays expired in the last 30 days');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector<HTMLElement>('.expired-panel')?.hidden).toBe(true);
  });

  it('shows each expired replay with when and under which window it was removed', async () => {
    await render(body);
    await settle(() => toggle()?.click());
    await flush();
    expect(toggle()?.textContent).toContain('Hide expired');
    const rows = [...host.querySelectorAll('.expired-row')];
    expect(rows.map((row) => row.querySelector('.expired-title')?.textContent)).toEqual([
      'Checkout with a declined card',
      'Signup form validation',
    ]);
    expect(rows[0]?.querySelector('.expired-reason')?.textContent).toMatch(/^Removed .+ after 90 days, the Triage window$/);
    expect(rows[1]?.querySelector('.expired-reason')?.textContent).toMatch(/^Removed .+ after 30 days$/);
    expect(host.querySelector('.expired-row a, .expired-row button')).toBeNull();
  });

  it('follows the search text and the chosen profile', async () => {
    await render(body, { query: 'SIGNUP' });
    expect(host.querySelector('.expired-summary')?.textContent).toBe('1 replay expired in the last 30 days');
    await render(body, { profile: 'triage' });
    expect(host.querySelector('.expired-summary')?.textContent).toBe('1 replay expired in the last 30 days');
  });

  it('stays out of the way when the deployment keeps no records or none match', async () => {
    await render({ days: 0, records: [] });
    expect(host.querySelector('.expired')).toBeNull();
    await render(body, { query: 'nothing like this' });
    expect(host.querySelector('.expired')).toBeNull();
  });
});
