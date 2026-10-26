// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { ViewerContext, type ViewerActions } from '../src/client/viewer/context.ts';
import { Transport } from '../src/client/viewer/Transport.tsx';
import { waterfallFixture } from './waterfall-fixture.ts';

let root: Root;
let host: HTMLDivElement;
let fullscreen: Element | null;
let originalFullscreen: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fullscreen = null;
  originalFullscreen = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  host = document.createElement('div');
  host.className = 'player-region';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (originalFullscreen) Object.defineProperty(document, 'fullscreenElement', originalFullscreen);
  else Reflect.deleteProperty(document, 'fullscreenElement');
  vi.unstubAllGlobals();
});

function find<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function transition(element: Element | null) {
  await act(async () => {
    fullscreen = element;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

async function renderTransport() {
  const player = new ReplayController(waterfallFixture());
  const viewer = { steps: [], errors: [], captions: false } as unknown as ViewerActions;
  await act(async () =>
    root.render(createElement(PlayerContext, { value: player }, createElement(ViewerContext, { value: viewer }, createElement(Transport)))),
  );
  return player;
}

describe('playback menu in fullscreen', () => {
  it('keeps the ordinary body portal and changes speed through a discrete slider', async () => {
    const player = await renderTransport();
    await click(find('.playback-options'));
    const menu = find('[data-slot="popover-content"][aria-label="Playback"]');
    expect(host.contains(menu)).toBe(false);
    expect(menu.textContent).toContain('Skip inactive parts');
    expect(menu.querySelector('[data-slot="slider-track"]')).not.toBeNull();
    expect(menu.querySelector('[data-slot="slider-thumb"]')).not.toBeNull();
    const rate = find<HTMLInputElement>('.playback-rate-slider input[type="range"]');
    await act(async () => {
      // React's controlled input tracker must see a native change rather than a programmatic setter.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(rate, '4');
      rate.dispatchEvent(new Event('input', { bubbles: true }));
      rate.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(player.getState().speed).toBe(2);
    expect(rate.getAttribute('aria-valuetext')).toBe('2×');
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens inside the fullscreen player and toggles inactivity without closing the menu', async () => {
    const player = await renderTransport();
    await transition(host);
    await click(find('.playback-options'));
    const menu = find('[data-slot="popover-content"][aria-label="Playback"]');
    expect(fullscreen?.contains(menu)).toBe(true);
    const skip = find('[role="switch"]');
    expect(skip.getAttribute('aria-checked')).toBe('true');
    await click(skip);
    expect(player.getState().skipInactive).toBe(false);
    expect(skip.getAttribute('aria-checked')).toBe('false');
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('true');
    await click(skip);
    expect(player.getState().skipInactive).toBe(true);
    await click(find('.playback-skip label'));
    expect(player.getState().skipInactive).toBe(false);
    expect(skip.getAttribute('aria-checked')).toBe('false');
  });

  it('changes speed with slider arrows without triggering viewer keyboard shortcuts', async () => {
    const player = await renderTransport();
    await click(find('.playback-options'));
    const seek = vi.fn<(event: KeyboardEvent) => void>();
    window.addEventListener('keydown', seek);
    try {
      await act(async () =>
        find('.playback-rate-slider input[type="range"]').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        ),
      );
      expect(seek).not.toHaveBeenCalled();
      expect(player.getState().speed).toBe(1.5);
    } finally {
      window.removeEventListener('keydown', seek);
    }
  });

  it('snaps to normal speed from its label without closing the popup', async () => {
    const player = await renderTransport();
    await act(async () => player.setSpeed(4));
    await click(find('.playback-options'));
    await click(find('[aria-label="Set playback speed to 1×"]'));
    expect(player.getState().speed).toBe(1);
    expect(find('[aria-label="Set playback speed to 1×"]').getAttribute('aria-pressed')).toBe('true');
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('true');
  });

  it('closes an open popup on fullscreen transitions and restores body placement after exit', async () => {
    await renderTransport();
    await click(find('.playback-options'));
    expect(host.contains(find('[data-slot="popover-content"][aria-label="Playback"]'))).toBe(false);
    await transition(host);
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('false');
    await click(find('.playback-options'));
    expect(host.contains(find('[data-slot="popover-content"][aria-label="Playback"]'))).toBe(true);
    await transition(null);
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('false');
    await click(find('.playback-options'));
    expect(host.contains(find('[data-slot="popover-content"][aria-label="Playback"]'))).toBe(false);
  });

  it('handles mounting already in fullscreen and Escape closes with focus returned to playback', async () => {
    fullscreen = host;
    await renderTransport();
    const trigger = find('.playback-options');
    await click(trigger);
    const menu = find('[data-slot="popover-content"][aria-label="Playback"]');
    expect(host.contains(menu)).toBe(true);
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(trigger);
  });
});
