// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEdits } from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { ViewerContext, type ViewerActions } from '../src/client/viewer/context.ts';
import { Inspector } from '../src/client/viewer/Inspector.tsx';
import { Waterfall } from '../src/client/viewer/Waterfall.tsx';
import { request, waterfallEdits, waterfallFixture } from './waterfall-fixture.ts';

// NumberFlow's animation custom element requires browser layout; keep the count text in DOM tests.
vi.mock('@number-flow/react', () => ({ default: ({ value }: { value: number }) => createElement('span', null, String(value)) }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector) ?? document.querySelector('.wf-filter-popover')?.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function key(element: HTMLElement, value: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}
async function changeSelect(label: string, value: string) {
  if (!document.querySelector(`select[aria-label="${label}"]`)) await click(find('[data-testid="waterfall-filters"]'));
  await act(async () => {
    const select = find<HTMLSelectElement>(`select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    // Bypass React's value tracker, just as a user's native input would.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function renderWaterfall(bundle: ReplayBundle, edited = false) {
  const shown = edited ? applyEdits(bundle, waterfallEdits) : undefined;
  const player = new ReplayController(shown?.bundle ?? bundle);
  const opened = vi.fn<(id: string) => void>();
  await act(async () =>
    root.render(
      createElement(
        PlayerContext,
        { value: player },
        createElement(Waterfall, {
          bundle,
          timeline: shown?.timeline,
          onNetworkSelection: opened,
          renderRequestDetail: (entry) => createElement('div', { 'data-request-detail': entry.id }, entry.url),
        }),
      ),
    ),
  );
  return { player, opened };
}

describe('waterfall DOM controls and replay selection', () => {
  it('seeks the shared replay on row activation, opens details, and moves focus/selection with arrows', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = [request(), request({ id: 'second', at: 3000, duration: 100 })];
    const { player, opened } = await renderWaterfall(bundle);
    const seek = vi.fn<() => void>();
    const off = player.subscribeSeek(seek);
    await click(find('[data-waterfall-id="network-0"]'));
    expect(player.getTime()).toBe(1000);
    expect(opened).toHaveBeenLastCalledWith('req');
    expect(find('[data-request-detail="req"]').textContent).toContain('/api/projects');
    expect(find('[data-waterfall-id="network-0"]').getAttribute('aria-expanded')).toBe('true');
    await key(find('[data-waterfall-id="network-0"]'), 'ArrowDown');
    expect(player.getTime()).toBe(3000);
    expect(document.activeElement).toBe(find('[data-waterfall-id="network-1"]'));
    expect(opened).toHaveBeenLastCalledWith('second');
    await key(find('[data-waterfall-id="network-1"]'), 'Escape');
    expect(find('section[aria-label="Selected waterfall event"]').hidden).toBe(true);
    expect(document.activeElement).toBe(find('[data-waterfall-id="network-1"]'));
    expect(seek).toHaveBeenCalledTimes(2);
    off();
  });

  it('uses edited geometry and seeks the first visible portion of a request starting inside a cut', async () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ at: 3500, duration: 1000 })];
    bundle.steps = [{ at: 3500, kind: 'click', label: 'Removed action' }];
    const { player } = await renderWaterfall(bundle, true);
    expect(player.duration).toBe(5000);
    expect(host.textContent).not.toContain('Removed action');
    const bar = find<HTMLElement>('[data-waterfall-id="network-0"] .wf-span');
    expect(bar.style.left).toBe('40%');
    expect(bar.style.width).toBe('5%');
    await click(find('[data-waterfall-id="network-0"]'));
    expect(player.getTime()).toBe(2000);
    expect(host.textContent).toContain('1.00 s measured');
    expect(host.textContent).toContain('250 ms visible in replay');
    expect(find<HTMLElement>('[data-testid="waterfall-playhead"]').style.left).toBe('40%');
    expect(find<HTMLInputElement>('[aria-label="Waterfall replay position"]').value).toBe('2000');
  });

  it('searches, filters failed/slow/incomplete requests and clears filters through real controls', async () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ status: 503 }), request({ id: 'fast', duration: 10 }), request({ id: 'open', status: 0, statusText: '' })];
    await renderWaterfall(bundle);
    await changeSelect('Waterfall state', 'failed');
    expect(host.querySelectorAll('.wf-row')).toHaveLength(1);
    expect(find('.wf-row').textContent).toContain('Failed');
    await input(find('input[type="search"]'), 'not present');
    expect(host.querySelectorAll('.wf-row')).toHaveLength(0);
    expect(host.textContent).toContain('No matching events');
    await click(Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Clear filters')!);
    expect(host.querySelectorAll('.wf-row')).toHaveLength(4);
    await changeSelect('Waterfall state', 'slow');
    expect(host.querySelectorAll('.wf-row')).toHaveLength(1);
    expect(find('.wf-row').textContent).toContain('Slow');
    await changeSelect('Waterfall state', 'incomplete');
    expect(find('.wf-row').textContent).toContain('duration unknown');
    await changeSelect('Waterfall state', 'all');
    await changeSelect('Waterfall track', 'action');
    expect(host.querySelectorAll('.wf-row')).toHaveLength(1);
    await input(find('input[type="search"]'), '#projects');
    expect(find('.wf-row').textContent).toContain('Open projects');
  });

  it('keeps ruler, controls and playhead on the existing player and isolates keyboard shortcuts', async () => {
    const { player } = await renderWaterfall(waterfallFixture());
    const shortcut = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener('keydown', shortcut);
    const slider = find<HTMLInputElement>('input[type="range"]');
    await input(slider, '4000');
    expect(player.getTime()).toBe(4000);
    expect(find<HTMLElement>('[data-testid="waterfall-playhead"]').style.left).toBe('40%');
    await act(async () => player.seek(7000));
    expect(slider.value).toBe('7000');
    await key(slider, 'ArrowRight');
    await key(find('input[type="search"]'), ' ');
    expect(shortcut).not.toHaveBeenCalled();
    document.removeEventListener('keydown', shortcut);
  });

  it('discloses filters outside the event/detail layout and Escape preserves selected detail and replay time', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = [request({ status: 503 }), request({ id: 'second', at: 3000, duration: 100 })];
    const { player } = await renderWaterfall(bundle);
    const scroller = find('[data-testid="waterfall-scroll"]');
    expect(document.querySelector('select[aria-label="Waterfall state"]')).toBeNull();
    await click(find('[data-waterfall-id="network-0"]'));
    await click(find('[data-testid="waterfall-filters"]'));
    const popup = document.querySelector('.wf-filter-popover');
    expect(popup).not.toBeNull();
    expect(find('.wf-workspace').contains(popup)).toBe(false);
    expect(find('.wf-tools').contains(popup)).toBe(false);
    await changeSelect('Waterfall state', 'failed');
    expect(find('[data-testid="waterfall-filters"]').textContent).toBe('Filters (1)');
    await key(find('select[aria-label="Waterfall state"]'), 'Escape');
    expect(find('[data-testid="waterfall-filters"]').getAttribute('aria-expanded')).toBe('false');
    expect(find('.wf-detail').hidden).toBe(false);
    expect(find('[data-waterfall-id="network-0"]').getAttribute('aria-expanded')).toBe('true');
    expect(find('[data-testid="waterfall-scroll"]')).toBe(scroller);
    expect(player.getTime()).toBe(1000);
  });

  it('keeps independent event and detail scroll regions while switching selected requests', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = [request(), request({ id: 'second', at: 3000, duration: 100 })];
    const { player, opened } = await renderWaterfall(bundle);
    const scroller = find('[data-testid="waterfall-scroll"]');
    await click(find('[data-waterfall-id="network-0"]'));
    const detail = find('.wf-detail');
    const workspace = find('.wf-workspace');
    expect(workspace.hasAttribute('data-detail-open')).toBe(true);
    expect(detail.parentElement).toBe(scroller.parentElement);
    expect(detail.tabIndex).toBe(0);
    scroller.scrollTop = 44;
    detail.scrollTop = 200;
    await click(find('[data-waterfall-id="network-1"]'));
    expect(find('[data-testid="waterfall-scroll"]')).toBe(scroller);
    expect(scroller.scrollTop).toBe(44);
    expect(detail.scrollTop).toBe(0);
    expect(find('[data-request-detail="second"]').textContent).toContain('/api/projects');
    expect(opened).toHaveBeenLastCalledWith('second');
    expect(player.getTime()).toBe(3000);
    await key(detail, 'Escape');
    expect(workspace.hasAttribute('data-detail-open')).toBe(false);
    expect(detail.hidden).toBe(true);
    expect(document.activeElement).toBe(find('[data-waterfall-id="network-1"]'));
  });

  it('opens action and paint details as point events without fake spans', async () => {
    const bundle = waterfallFixture();
    bundle.performance = { supported: ['paint'], entries: [{ at: 2000, kind: 'first-contentful-paint', value: 500 }] };
    const { player } = await renderWaterfall(bundle);
    await click(find('[data-waterfall-id="action-0"]'));
    expect(player.getTime()).toBe(1500);
    expect(find('.wf-facts').textContent).toContain('#projects');
    await click(find('[data-waterfall-id="performance-0"]'));
    expect(player.getTime()).toBe(2000);
    expect(find('.wf-facts').textContent).toContain('Metric timestamp from navigation');
    expect(host.querySelectorAll('.wf-span')).toHaveLength(0);
    expect(host.querySelectorAll('.wf-point')).toHaveLength(2);
  });

  it('keeps invalid task durations distinct from paint metric timestamps and renders empty tracks', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    const { player } = await renderWaterfall(bundle);
    expect(host.textContent).toContain('No timed events');
    expect(find<HTMLInputElement>('input[type="range"]').max).toBe(String(player.duration));
    bundle.performance = { supported: ['longtask'], entries: [{ at: 1000, kind: 'long-task', value: NaN }] };
    await renderWaterfall({ ...bundle });
    await click(find('[data-waterfall-id="performance-0"]'));
    expect(find('.wf-facts').textContent).toContain('Measured duration');
    expect(find('.wf-facts').textContent).toContain('Invalid value');
    expect(host.querySelector('.wf-span')).toBeNull();
    expect(host.textContent).toContain('Invalid / unknown duration');
  });

  it('windows a large recording and keyboard-selects the final row outside the initial window', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = Array.from({ length: 5000 }, (_, index) => request({ id: `req-${index}`, at: index, duration: 10 }));
    const { player } = await renderWaterfall(bundle);
    const scroller = find<HTMLElement>('[data-testid="waterfall-scroll"]');
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 220 });
    expect(host.querySelectorAll('.wf-row').length).toBeLessThan(40);
    await key(find('.wf-row'), 'End');
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(player.getTime()).toBe(4999);
    expect(document.activeElement).toBe(find('[data-waterfall-id="network-4999"]'));
    expect(host.querySelectorAll('.wf-row').length).toBeLessThan(40);
  });

  it('is discoverable in Inspector and reuses actual network headers/details while retaining list tabs', async () => {
    const bundle = waterfallFixture();
    bundle.network = [request({ requestHeaders: [{ name: 'Authorization', value: '[REDACTED]' }] })];
    const player = new ReplayController(bundle);
    function Harness() {
      const [tab, setTab] = useState<Parameters<typeof Inspector>[0]['tab']>('console');
      const [expanded, setExpandedRequest] = useState<string>();
      const actions = { setTab, setExpandedRequest } as ViewerActions;
      return createElement(
        PlayerContext,
        { value: player },
        createElement(ViewerContext, { value: actions }, createElement(Inspector, { bundle, tab, expandedRequest: expanded })),
      );
    }
    const queries = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    await act(async () => root.render(createElement(QueryClientProvider, { client: queries }, createElement(Harness))));
    expect(find('[data-testid="network-tab"]').textContent).toContain('Network');
    await click(find('[data-testid="waterfall-tab"]'));
    expect(find('[data-testid="waterfall-tab"]').getAttribute('aria-selected')).toBe('true');
    await click(find('[data-waterfall-id="network-0"]'));
    expect(player.getTime()).toBe(1000);
    expect(find('.rd-grid').textContent).toContain('Request headers');
    expect(find('.rd-grid').textContent).toContain('[REDACTED]');
    expect(find('.rd-grid').textContent).toContain('Request and response bodies are not retained');
    await click(find('[data-testid="network-tab"]'));
    expect(find('[data-request-id="req"]').getAttribute('aria-expanded')).toBe('true');
  });

  it('passes original diagnostics through Inspector for edited crossing requests and exposes honest source details', async () => {
    const bundle = waterfallFixture();
    bundle.network = [
      request({ at: 3500, duration: 1000 }),
      request({ id: 'incomplete', at: 6000, status: 0, statusText: '', duration: 0 }),
    ];
    const shown = applyEdits(bundle, waterfallEdits);
    const player = new ReplayController(shown.bundle);
    const queries = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    const actions = { setTab: () => {}, setExpandedRequest: () => {} } as unknown as ViewerActions;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queries },
          createElement(
            PlayerContext,
            { value: player },
            createElement(
              ViewerContext,
              { value: actions },
              createElement(Inspector, {
                bundle: shown.bundle,
                sourceBundle: bundle,
                timeline: shown.timeline,
                tab: 'waterfall',
                expandedRequest: undefined,
              }),
            ),
          ),
        ),
      ),
    );
    expect(shown.bundle.network.some((entry) => entry.id === 'req')).toBe(false);
    await click(find('[data-waterfall-id="network-0"]'));
    expect(player.getTime()).toBe(2000);
    expect(find('.rd-facts').textContent).toContain('1000.0 ms');
    expect(host.textContent).toContain('250 ms visible in replay');
    await click(find('[data-waterfall-id="network-1"]'));
    expect(find('.rd-facts').textContent).toContain('Unknown / incomplete');
    expect(find('.rd-facts').textContent).toContain('No response recorded');
  });

  it('returns focus to an offscreen selected row when closing details without seeking again', async () => {
    const bundle = waterfallFixture();
    bundle.steps = [];
    bundle.network = Array.from({ length: 5000 }, (_, index) => request({ id: `req-${index}`, at: index, duration: 10 }));
    const { player } = await renderWaterfall(bundle);
    await click(find('[data-waterfall-id="network-0"]'));
    const seek = vi.fn<() => void>();
    const off = player.subscribeSeek(seek);
    const scroller = find<HTMLElement>('[data-testid="waterfall-scroll"]');
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 220 });
    await act(async () => {
      scroller.scrollTop = 100000;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(host.querySelector('[data-waterfall-id="network-0"]')).toBeNull();
    await click(Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close details')!);
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(find('[data-waterfall-id="network-0"]'));
    expect(player.getTime()).toBe(0);
    expect(seek).not.toHaveBeenCalled();
    off();
  });
});
