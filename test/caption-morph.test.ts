// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptionMorph } from '../src/client/CaptionMorph.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;
let media: MediaQueryList;
function renderLabel(text: string) {
  return createElement(
    'div',
    { role: 'status', 'aria-live': 'off', 'aria-label': text },
    createElement('span', { 'aria-hidden': 'true' }, createElement(CaptionMorph, { text })),
  );
}

/** Registers a happy-dom host with a stubbed reduced-motion query for the enclosing describe. */
function useMorphHarness() {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    media = Object.assign(new EventTarget(), {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    });
    vi.stubGlobal('matchMedia', () => media);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });
}

describe('caption text swap', () => {
  useMorphHarness();

  it('keeps one caption host and exposes the final caption once', async () => {
    await settle(() => {
      root.render(renderLabel('Opening settings'));
    });
    const hostBefore = host.querySelector('[data-caption-morph]');
    expect(hostBefore).not.toBeNull();
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Opening settings');
    expect(host.querySelector('[aria-hidden="true"] [data-caption-text]')?.textContent).toBe('Opening settings');

    await settle(() => {
      root.render(renderLabel('Save changes'));
    });
    expect(host.querySelector('[data-caption-morph]')).toBe(hostBefore);
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Save changes');
  });

  it('swaps the whole line on a change instead of morphing per character', async () => {
    await settle(() => {
      root.render(renderLabel('AB'));
    });
    const before = host.querySelector('[data-caption-text]');
    await settle(() => {
      root.render(renderLabel('AC'));
    });
    const after = host.querySelector('[data-caption-text]');
    expect(after).not.toBe(before);
    expect(after?.textContent).toBe('AC');
    expect(host.querySelectorAll('[data-caption-text]')).toHaveLength(1);
  });

  it('retargets rapid seeks and empty gaps without remounting the caption host', async () => {
    await settle(() => {
      root.render(renderLabel('Opening settings'));
    });
    const persistent = host.querySelector('[data-caption-morph]');
    for (const label of ['Open cart', 'Review cart', '', 'Save changes']) {
      await settle(() => {
        root.render(renderLabel(label));
      });
      expect(host.querySelector('[data-caption-morph]')).toBe(persistent);
      expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(label);
    }
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-caption-text]')).toHaveLength(1);
  });

  it('marks reduced motion, including a live preference change', async () => {
    await settle(() => {
      root.render(renderLabel('Open cart'));
    });
    const persistent = host.querySelector('[data-caption-morph]');
    await settle(() => {
      Object.defineProperty(media, 'matches', { configurable: true, value: true });
      media.dispatchEvent(new Event('change'));
    });
    await settle(() => {
      root.render(renderLabel('Save changes'));
    });
    expect(host.querySelector('[data-caption-morph]')).toBe(persistent);
    expect(persistent?.getAttribute('data-motion')).toBe('reduced');
    expect(persistent?.textContent).toBe('Save changes');
    expect(persistent?.querySelector('[style*="transform"]')).toBeNull();
  });
});
