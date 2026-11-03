// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TopbarIdentity } from '../src/client/components/topbar-identity.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;
let media: MediaQueryList;

function identity(title: string, status: string) {
  return createElement(TopbarIdentity, { title }, [
    createElement('h1', { key: 'title' }, title),
    createElement('span', { key: 'status' }, status),
  ]);
}

describe('topbar identity transition', () => {
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
    await settle(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fades title and status as one stable host and cancels motion when rapid changes arrive', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    await settle(() => root.render(identity('Chrome', 'Passed')));
    const element = host.querySelector<HTMLDivElement>('[data-topbar-identity]');
    if (!element) throw new Error('Expected the title and status transition host');
    const animation = new Animation();
    const cancel = vi.spyOn(animation, 'cancel');
    const animate = vi.fn<HTMLElement['animate']>(() => animation);
    element.animate = animate;
    clock.mockReturnValue(2000);
    await settle(() => root.render(identity('Firefox', 'Failed')));
    expect(animate).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('FirefoxFailed');
    expect(element.querySelectorAll('h1')).toHaveLength(1);
    clock.mockReturnValue(3000);
    await settle(() => root.render(identity('Firefox', 'Passed')));
    expect(animate).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(3050);
    await settle(() => root.render(identity('Safari', 'Passed')));
    expect(host.querySelector('[data-topbar-identity]')).toBe(element);
    expect(element.textContent).toBe('SafariPassed');
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels a running transition when reduced motion is enabled and keeps subsequent swaps instant', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    await settle(() => root.render(identity('Chrome', 'Passed')));
    const element = host.querySelector<HTMLDivElement>('[data-topbar-identity]');
    if (!element) throw new Error('Expected the title and status transition host');
    const animation = new Animation();
    const cancel = vi.spyOn(animation, 'cancel');
    const animate = vi.fn<HTMLElement['animate']>(() => animation);
    element.animate = animate;
    clock.mockReturnValue(2000);
    await settle(() => root.render(identity('Firefox', 'Failed')));
    await settle(() => {
      Object.defineProperty(media, 'matches', { value: true, configurable: true });
      media.dispatchEvent(new Event('change'));
    });
    expect(cancel).toHaveBeenCalled();
    clock.mockReturnValue(3000);
    await settle(() => root.render(identity('Safari', 'Passed')));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe('SafariPassed');
  });
});
