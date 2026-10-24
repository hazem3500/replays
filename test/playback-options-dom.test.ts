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
  it('keeps the ordinary body portal and changes speed through real menu items', async () => {
    const player = await renderTransport();
    await click(find('.playback-options'));
    const menu = find('[role="menu"][aria-label="Playback"]');
    expect(host.contains(menu)).toBe(false);
    expect(menu.textContent).toContain('Skip inactive parts');
    const rate = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === '2×');
    expect(rate).toBeDefined();
    await click(rate!);
    expect(player.getState().speed).toBe(2);
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens inside the fullscreen player and toggles inactivity without closing the menu', async () => {
    const player = await renderTransport();
    await transition(host);
    await click(find('.playback-options'));
    const menu = find('[role="menu"][aria-label="Playback"]');
    expect(fullscreen?.contains(menu)).toBe(true);
    const skip = find('[role="menuitemcheckbox"]');
    expect(skip.getAttribute('aria-checked')).toBe('true');
    await click(skip);
    expect(player.getState().skipInactive).toBe(false);
    expect(skip.getAttribute('aria-checked')).toBe('false');
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('true');
    await click(skip);
    expect(player.getState().skipInactive).toBe(true);
  });

  it('closes an open popup on fullscreen transitions and restores body placement after exit', async () => {
    await renderTransport();
    await click(find('.playback-options'));
    expect(host.contains(find('[role="menu"][aria-label="Playback"]'))).toBe(false);
    await transition(host);
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('false');
    await click(find('.playback-options'));
    expect(host.contains(find('[role="menu"][aria-label="Playback"]'))).toBe(true);
    await transition(null);
    expect(find('.playback-options').getAttribute('aria-expanded')).toBe('false');
    await click(find('.playback-options'));
    expect(host.contains(find('[role="menu"][aria-label="Playback"]'))).toBe(false);
  });

  it('handles mounting already in fullscreen and Escape closes with focus returned to playback', async () => {
    fullscreen = host;
    await renderTransport();
    const trigger = find('.playback-options');
    await click(trigger);
    const menu = find('[role="menu"][aria-label="Playback"]');
    expect(host.contains(menu)).toBe(true);
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(trigger);
  });
});
