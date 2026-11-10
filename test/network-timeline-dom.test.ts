// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { NetworkTimeline } from '../src/client/viewer/network/NetworkTimeline.tsx';
import { setRibbonCollapsed } from '../src/client/viewer/ribbon-collapse.ts';
import { request, waterfallFixture } from './waterfall-fixture.ts';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  setRibbonCollapsed(false, 'network');
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  const bundle = waterfallFixture();
  bundle.network = [
    request({ id: 'a', at: 500, duration: 40 }),
    request({ id: 'b', at: 600, duration: 900 }),
    request({ id: 'c', at: 2000, duration: 30, status: 500, statusText: 'Server Error' }),
  ];
  const rows = buildNetworkRows(bundle);
  const player = new ReplayController(bundle);
  await act(async () =>
    root.render(
      createElement(
        PlayerContext,
        { value: player },
        createElement(NetworkTimeline, {
          rows,
          duration: 10_000,
          range: undefined,
          onRange: () => undefined,
          lit: [],
          onLight: () => undefined,
        }),
      ),
    ),
  );
}

describe('the Network timeline', () => {
  it('draws the density lane and the failed and slow marks, named in the gutter', async () => {
    await render();
    expect(host.querySelectorAll('.nt-density rect').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.pt-mark[data-lane="failed"]')).toHaveLength(1);
    expect([...host.querySelectorAll('.pt-label-text')].map((label) => label.textContent)).toEqual(['Requests', 'Slow', 'Failed']);
    expect(host.textContent).not.toContain('Click to seek');
  });

  it('renders no chart at all when collapsed, only the toggle, and remembers it per tab', async () => {
    setRibbonCollapsed(true, 'network');
    await render();
    expect(host.querySelector('.pt-body, .pt-plot, .pt-mark, .nt-density, .pt-axis, .ribbon-handle')).toBeNull();
    const toggle = host.querySelector('.ribbon-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('replays-network-timeline-collapsed')).toBe('1');
    expect(localStorage.getItem('replays-ribbon-collapsed')).toBeNull();
    await act(async () => (toggle as HTMLElement).click());
    expect(host.querySelector('.nt-density')).not.toBeNull();
  });
});
