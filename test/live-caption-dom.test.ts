// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveCaption } from '../src/client/LiveCaption.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;

const render = (text?: string, number?: number) =>
  settle(() => root.render(createElement(LiveCaption, { text, number, testId: 'step-caption' })));

function caption() {
  const element = host.querySelector<HTMLElement>('[data-testid="step-caption"]');
  if (!element) throw new Error('expected the caption host');
  return element;
}

describe('live caption presence', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false, media: '' }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the last caption (text and number) while it hides, so the box never collapses before it fades', async () => {
    await render('Open the cart', 3);
    expect(caption().dataset.active).toBe('true');
    await render();
    expect(caption().dataset.active).toBe('false');
    expect(caption().querySelector('[data-caption-text]')?.textContent).toBe('Open the cart');
    expect(caption().querySelector('.step-caption-number')?.textContent).toBe('3');
    expect(caption().getAttribute('aria-label')).toBeNull();
  });

  it('swaps text in place between consecutive captions, and starts fresh after a hide', async () => {
    await render('Open the cart');
    const morph = caption().querySelector('[data-caption-morph]');
    await render('Apply the coupon');
    expect(caption().querySelector('[data-caption-morph]')).toBe(morph);
    expect(caption().getAttribute('aria-label')).toBe('Apply the coupon');
    await render();
    await render('Place the order');
    expect(caption().querySelector('[data-caption-morph]')).not.toBe(morph);
    expect(caption().dataset.active).toBe('true');
    expect(caption().querySelector('[data-caption-text]')?.textContent).toBe('Place the order');
  });
});
