// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '../src/client/components/ui/tooltip.tsx';
import { setSourceLooksForTests } from '../src/client/source-looks.ts';
import { type ChipSource, SourceChip } from '../src/client/viewer/SourceChip.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('viewer top bar source chip', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setSourceLooksForTests({
      tickets: { label: 'Tickets', noun: 'Ticket', mark: 'jira' },
      docs: { label: 'Docs', icon: 'https://docs.example.com/icon.svg' },
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    setSourceLooksForTests(undefined);
  });

  function chip(source: ChipSource) {
    act(() => {
      root.render(createElement(TooltipProvider, null, createElement(SourceChip, { source })));
    });
    const link = host.querySelector('[data-testid="source-chip"]');
    if (!link) throw new Error('Expected the source chip to be rendered');
    return link;
  }

  it.each(['github', 'gitlab', 'linear', 'slack', 'notion', 'jira'] as const)('draws the %s mark the index uses', (provider) => {
    const link = chip({ provider, url: `https://${provider}.example.com/1`, label: 'Item 1' });
    expect(link.querySelector('svg[data-provider-mark]')?.getAttribute('data-provider-mark')).toBe(provider);
  });

  it('draws the mark a configured provider declares', () => {
    const link = chip({ provider: 'tickets', url: 'https://tickets.example.com/SHOP-7', label: 'SHOP-7' });
    expect(link.querySelector('[data-provider-mark]')?.getAttribute('data-provider-mark')).toBe('jira');
    expect(link.getAttribute('aria-label')).toBe('SHOP-7, Ticket (opens in a new tab)');
  });

  it('draws a provider’s own icon image when it declares one', () => {
    const link = chip({ provider: 'docs', url: 'https://docs.example.com/page', label: 'Runbook' });
    expect(link.querySelector('img[data-provider-icon="docs"]')?.getAttribute('src')).toBe('https://docs.example.com/icon.svg');
  });

  it('falls back to a link glyph for an unknown provider', () => {
    const link = chip({ provider: 'wiki', url: 'https://wiki.example.com/page', label: 'Notes' });
    expect(link.querySelector('[data-provider-mark]')?.getAttribute('data-provider-mark')).toBe('link');
  });
});
