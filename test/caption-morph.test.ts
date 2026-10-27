// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptionMorph } from '../src/client/CaptionMorph.tsx';

let host: HTMLDivElement;
let root: Root;
let media: MediaQueryList;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  media = Object.assign(new EventTarget(), { matches: false, media: '(prefers-reduced-motion: reduce)' }) as MediaQueryList;
  vi.stubGlobal('matchMedia', () => media);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function renderLabel(text: string) {
  return createElement(
    'div',
    { role: 'status', 'aria-live': 'off', 'aria-label': text },
    createElement('span', { 'aria-hidden': 'true' }, createElement(CaptionMorph, { text })),
  );
}

describe('Calligraph caption morph', () => {
  it('retargets one mounted character host and exposes the final caption once', async () => {
    await act(async () => root.render(renderLabel('Opening settings')));
    const hostBefore = host.querySelector('[data-calligraph]');
    expect(hostBefore).not.toBeNull();
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Opening settings');
    expect(host.querySelector('[aria-hidden="true"] [data-calligraph]')).not.toBeNull();

    await act(async () => root.render(renderLabel('Save changes')));
    expect(host.querySelector('[data-calligraph]')).toBe(hostBefore);
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Save changes');
  });

  it('retains shared character nodes instead of replacing the whole label', async () => {
    await act(async () => root.render(renderLabel('AB')));
    const shared = [...host.querySelectorAll('[data-calligraph] span')].find((node) => node.textContent === 'A');
    expect(shared).toBeDefined();
    await act(async () => root.render(renderLabel('AC')));
    expect([...host.querySelectorAll('[data-calligraph] span')].find((node) => node.textContent === 'A')).toBe(shared);
  });

  it('retargets rapid seeks and empty gaps without remounting the caption host', async () => {
    await act(async () => root.render(renderLabel('Opening settings')));
    const persistent = host.querySelector('[data-caption-morph]');
    for (const label of ['Open cart', 'Review cart', '', 'Save changes']) {
      await act(async () => root.render(renderLabel(label)));
      expect(host.querySelector('[data-caption-morph]')).toBe(persistent);
      expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(label);
    }
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-calligraph]')).toHaveLength(1);
  });

  it('uses immediate final text under reduced motion, including a live preference change', async () => {
    await act(async () => root.render(renderLabel('Open cart')));
    const persistent = host.querySelector('[data-caption-morph]');
    await act(async () => {
      Object.defineProperty(media, 'matches', { configurable: true, value: true });
      media.dispatchEvent(new Event('change'));
    });
    await act(async () => root.render(renderLabel('Save changes')));
    expect(host.querySelector('[data-caption-morph]')).toBe(persistent);
    expect(persistent?.getAttribute('data-motion')).toBe('reduced');
    expect(persistent?.textContent).toBe('Save changes');
    expect(persistent?.querySelector('[data-calligraph]')).toBeNull();
    expect(persistent?.querySelector('[style*="transform"]')).toBeNull();
  });
});
