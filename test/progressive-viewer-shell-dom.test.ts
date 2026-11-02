// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgressiveViewerShell } from '../src/client/ProgressiveViewerShell.tsx';
import { waterfallFixture } from './waterfall-fixture.ts';

let root: Root;
let host: HTMLDivElement;
let originalWidth: number;

beforeEach(() => {
  localStorage.clear();
  originalWidth = window.innerWidth;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 720px') ? window.innerWidth <= 720 : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/r/demo');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function Harness({ bundle }: { bundle?: ReturnType<typeof waterfallFixture> }) {
  const [activePanel, setActivePanel] = useState('network');
  return createElement(ProgressiveViewerShell, {
    title: 'Demo replay',
    activePanel,
    onPanelChange: setActivePanel,
    ...(bundle ? { bundle } : {}),
  });
}

describe('progressive replay viewer shell', () => {
  it('renders real navigation immediately without inventing unavailable steps or playback metadata', async () => {
    await act(async () => root.render(createElement(Harness, {})));

    expect(find('main.progressive-viewer-loading').hasAttribute('aria-busy')).toBe(false);
    expect(find('.player-region').getAttribute('aria-busy')).toBe('true');
    expect(find('h1').textContent).toContain('Demo replay');
    expect(find('[role="tablist"] [role="tab"][id="network-tab"]').textContent).toContain('Network');
    expect(host.querySelector('[id="steps-tab"]')).toBeNull();
    expect(find('[role="tabpanel"]').getAttribute('aria-busy')).toBe('true');
    expect(find<HTMLButtonElement>('.play-button').disabled).toBe(true);
    expect(host.textContent).not.toMatch(/Opening replay|\b0%|\b0 of 0\b/);
  });

  it('shows the bundle’s real steps and console rows before the player code arrives', async () => {
    const bundle = waterfallFixture();
    await act(async () => root.render(createElement(Harness, { bundle })));

    // Steps have one home: with the rail on screen there is no Steps tab.
    expect(host.querySelector('[id="steps-tab"]')).toBeNull();
    // Real labels in the rail's geometry (no placeholders once the bundle is here).
    const rows = host.querySelectorAll('.timeline-panel .loading-real .step');
    expect(rows).toHaveLength(bundle.steps.length);
    expect(rows[0]?.textContent).toContain(bundle.steps[0]!.label);
    expect(host.querySelector('.timeline-panel .loading-rows')).toBeNull();
    await click(find('[id="console-tab"]'));
    expect(find('[id="console-tab"]').getAttribute('aria-selected')).toBe('true');
    expect(host.querySelectorAll('.console-table.loading-real tbody tr')).toHaveLength(Math.min(bundle.console.length, 24));
  });

  it('keeps known navigation usable while folded and carries the fold preference to the ready viewer', async () => {
    localStorage.setItem('replays-inspector-collapsed', '1');
    await act(async () => root.render(createElement(Harness, {})));
    expect(find<HTMLElement>('[role="tabpanel"]').hidden).toBe(true);
    await click(find('[data-testid="inspector-collapse"]'));
    expect(find<HTMLElement>('[role="tabpanel"]').hidden).toBe(false);
    expect(localStorage.getItem('replays-inspector-collapsed')).toBe('0');
    await click(find('[data-testid="inspector-collapse"]'));
    await click(find('[id="console-tab"]'));
    expect(find<HTMLElement>('[role="tabpanel"]').hidden).toBe(false);
    expect(find('[id="console-tab"]').getAttribute('aria-selected')).toBe('true');
  });

  it('draws the real transport and headers, with placeholder rows instead of loading sentences', async () => {
    sessionStorage.setItem('replays-open-hint', JSON.stringify({ id: 'demo', steps: 9 }));
    await act(async () => root.render(createElement(Harness, {})));

    // The whole transport row, inert: play, the clock, the seek track, captions and speed.
    expect(find('.transport .scrubber .scrubber-segment')).not.toBeNull();
    expect(find('.transport .transport-time').textContent).toMatch(/^0:00/);
    expect(find<HTMLButtonElement>('.transport .playback-options').disabled).toBe(true);
    expect(find<HTMLButtonElement>('.transport .captions-switch').disabled).toBe(true);
    // At most five step rows, whatever the step count.
    expect(host.querySelectorAll('.timeline-panel .loading-step')).toHaveLength(5);
    // Status sentences are for screen readers only.
    for (const status of host.querySelectorAll('[role="status"]')) expect(status.className).toContain('visually-hidden');
    expect(find('.topbar-actions [aria-label="Copy link"]').hasAttribute('disabled')).toBe(true);
  });

  it('falls back from a failed known poster to the calm frame on a phone', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    sessionStorage.setItem('replays-open-hint', JSON.stringify({ id: 'demo', poster: '/missing-poster.png' }));
    await act(async () => root.render(createElement(Harness, {})));

    expect(find('main').hasAttribute('data-mobile')).toBe(true);
    const poster = find<HTMLImageElement>('.loading-poster');
    await act(async () => poster.dispatchEvent(new Event('error')));
    expect(host.querySelector('.loading-poster')).toBeNull();
    expect(find('.loading-frame').hasAttribute('data-poster')).toBe(false);
    // The download still shows, as the ring where play will be.
    expect(find('.loading-ring')).not.toBeNull();
  });
});
