// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveCaption } from '../src/client/LiveCaption.tsx';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false, media: '' }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (text: string | undefined, number?: number) =>
  act(async () => root.render(createElement(LiveCaption, { text, number, testId: 'step-caption' })));
const caption = () => host.querySelector<HTMLElement>('[data-testid="step-caption"]')!;

describe('live caption presence', () => {
  it('keeps the last caption (text and number) while it hides, so the box never collapses before it fades', async () => {
    await render('Open the cart', 3);
    expect(caption().dataset.active).toBe('true');
    await render(undefined);
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
    await render(undefined);
    await render('Place the order');
    expect(caption().querySelector('[data-caption-morph]')).not.toBe(morph);
    expect(caption().dataset.active).toBe('true');
    expect(caption().querySelector('[data-caption-text]')?.textContent).toBe('Place the order');
  });
});
