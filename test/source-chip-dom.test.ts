// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySourceLink } from '../src/shared/replay.ts';
import { SourceLead } from '../src/client/index/SourceLine.tsx';
import { setSourceLooksForTests } from '../src/client/source-looks.ts';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;

function present<T extends Element>(element: T | null | undefined) {
  if (!element) throw new Error('expected the element to be rendered');
  return element;
}

function phone(matches: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: matches && media.includes('max-width: 640px'),
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const sources: ReplaySourceLink[] = [
  { provider: 'github', label: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' },
  { provider: 'tickets', label: 'SHOP-7', url: 'https://tickets.example.com/SHOP-7' },
];

async function render(list: ReplaySourceLink[]) {
  await settle(() => root.render(createElement(SourceLead, { sources: list, origin: 'agent' })));
}

describe('index row source', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setSourceLooksForTests({ github: { label: 'GitHub', mark: 'github' }, tickets: { label: 'Tickets', noun: 'Ticket', mark: 'jira' } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => root.unmount());
    host.remove();
    setSourceLooksForTests(undefined);
    vi.unstubAllGlobals();
  });

  it('desktop: the provider mark and the label as a link out, the rest behind +N', async () => {
    phone(false);
    await render(sources);
    const link = present(host.querySelector<HTMLAnchorElement>('a.source-link'));
    expect(link.href).toBe('https://github.com/acme/api/issues/12');
    expect(link.getAttribute('aria-label')).toBe('github · acme/api#12 (opens in a new tab)');
    // why: the mark already says GitHub, so the visible text is the label alone.
    expect(link.querySelector('.source-link-text')?.textContent).toBe('api#12');
    expect(link.querySelector('[data-provider-mark="github"]')).not.toBeNull();
    expect(host.querySelector('.source-more')?.getAttribute('aria-label')).toBe('1 more source');
  });

  it('keeps the provider in the text when only the generic link glyph would show', async () => {
    phone(false);
    await render([{ provider: 'chat', label: 'C1', url: 'https://chat.example.com/C1' }]);
    expect(host.querySelector('.source-link-text')?.textContent).toBe('chat · C1');
    expect(host.querySelector('[data-provider-mark="link"]')).not.toBeNull();
  });

  it('phones: one icon chip, no link in the row; it opens a sheet of every source', async () => {
    phone(true);
    await render(sources);
    expect(host.querySelector('a')).toBeNull();
    const chip = present(host.querySelector<HTMLButtonElement>('.source-chip'));
    expect(chip.getAttribute('aria-label')).toBe('Sources: github · acme/api#12 and 1 more');
    expect(chip.textContent).toBe('+1');
    await settle(() => chip.click());
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('.source-sheet-row')];
    expect(rows.map((row) => row.href)).toEqual(['https://github.com/acme/api/issues/12', 'https://tickets.example.com/SHOP-7']);
    const ticket = present(rows[1]);
    expect(ticket.getAttribute('aria-label')).toBe('tickets · SHOP-7, Ticket (opens in a new tab)');
    expect(ticket.querySelector('[data-provider-mark="jira"]')).not.toBeNull();
  });
});
