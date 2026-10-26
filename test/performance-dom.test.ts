// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEdits } from '../src/shared/edits.ts';
import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { ViewerContext, type ViewerActions } from '../src/client/viewer/context.ts';
import { Inspector } from '../src/client/viewer/Inspector.tsx';
import { PerformanceDiagnostics } from '../src/client/viewer/Performance.tsx';
import { buildPerformance } from '../src/client/viewer/performance.ts';
import { performanceFixture } from './performance-fixture.ts';
import { waterfallEdits, request } from './waterfall-fixture.ts';

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

function find<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function key(element: HTMLElement, value: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}
async function frames() {
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}
async function renderPerformance(bundle = performanceFixture(), edited = false) {
  const shown = edited ? applyEdits(bundle, waterfallEdits) : undefined;
  const player = new ReplayController(shown?.bundle ?? bundle);
  const model = buildPerformance(bundle, shown?.timeline);
  await act(async () =>
    root.render(
      createElement(
        PlayerContext,
        { value: player },
        createElement(PerformanceDiagnostics, {
          model,
          renderRequestDetail: (entry) => createElement('div', { 'data-network-detail': entry.id }, entry.url),
        }),
      ),
    ),
  );
  return { player, model };
}

describe('performance diagnosis DOM and player integration', () => {
  it('starts with compact kind filters and exposes search only on request', async () => {
    await renderPerformance();
    expect(host.querySelector('input[type="search"]')).toBeNull();
    const tasks = [...host.querySelectorAll<HTMLButtonElement>('.perf-filter')].find(
      (candidate) => candidate.textContent === 'Long tasks',
    )!;
    await click(tasks);
    expect(tasks.getAttribute('aria-pressed')).toBe('true');
    expect(find('.perf-events').querySelectorAll('.perf-event')).toHaveLength(2);
    expect(find('.perf-events').textContent).toContain('Main-thread task');
    await click(find('[aria-label="Search performance events"]'));
    expect(find('input[type="search"]')).toBeDefined();
    await click(find('[aria-label="Close event search"]'));
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(tasks.isConnected).toBe(false);
    expect(find('.perf-filter[aria-pressed="true"]').textContent).toBe('Long tasks');
  });

  it('reuses the diagnostic clock drag handle and its keyboard seeking', async () => {
    const { player } = await renderPerformance();
    const grip = find<HTMLElement>('.now-grip');
    expect(grip.getAttribute('role')).toBe('slider');
    await key(grip, 'End');
    expect(player.getTime()).toBe(player.duration);
    await key(grip, 'Home');
    expect(player.getTime()).toBe(0);
    await key(grip, 'ArrowDown');
    expect(player.getTime()).toBe(1000);
    expect(find('.perf-events').querySelector('[data-testid="now-divider"]')).toBeDefined();
  });

  it('selects an event, seeks the existing player and opens related request details without losing event access', async () => {
    const { player } = await renderPerformance();
    const main = find('[data-testid="performance-main"]');
    await click(find('.perf-events [data-performance-id="performance-1"]'));
    expect(player.getTime()).toBe(1700);
    expect(find('.perf-facts').textContent).toContain('Captured duration420 ms');
    expect(host.querySelector('.perf-detail > .diagnostic-timing')).toBeNull();
    expect(find('.perf-raw').hasAttribute('open')).toBe(false);
    expect(find('.perf-detail').textContent).toContain('not proof of a cause');
    expect(find('[data-testid="performance-main"]')).toBe(main);
    await click(find('.perf-detail [data-performance-id="network-0"]'));
    expect(player.getTime()).toBe(1600);
    expect(find('[data-network-detail="req"]').textContent).toContain('/api/projects');
    expect(find('.perf-events [data-performance-id="performance-1"]')).toBeDefined();
  });

  it('draws edited span endpoints and seeks the retained portion of a task whose start was cut', async () => {
    const bundle = performanceFixture();
    bundle.performance!.entries = [{ at: 3500, kind: 'long-task', value: 1000 }];
    const { player } = await renderPerformance(bundle, true);
    const bar = find('.perf-events [data-performance-id="performance-0"] .diagnostic-timing-span');
    expect(bar.style.left).toBe('40%');
    expect(bar.style.width).toBe('5%');
    await click(find('.perf-events [data-performance-id="performance-0"]'));
    expect(player.duration).toBe(5000);
    expect(player.getTime()).toBe(2000);
    expect(find('.perf-detail').textContent).toContain('1.00 s');
    expect(find('.perf-edit-note').textContent).toContain('Source time 0:03.5');
    expect(find('.perf-edit-note').textContent).toContain('250 ms kept in replay');
    expect(find('.perf-facts').textContent).toContain('Replay time0:02.0');
  });

  it('searches captured events, labels paint values from navigation and restores selection focus on Escape', async () => {
    const { player } = await renderPerformance();
    await click(find('[aria-label="Search performance events"]'));
    const input = find<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'paint');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(find('.perf-events').querySelectorAll('.perf-event')).toHaveLength(2);
    const candidate = find('.perf-events [data-performance-id="performance-3"]');
    expect(candidate.querySelector('.perf-event-value')?.textContent).toBe('2.40 s nav.');
    expect(candidate.querySelector('.perf-event-value')?.getAttribute('title')).toContain('from navigation');
    await click(candidate);
    expect(player.getTime()).toBe(2400);
    expect(find('.perf-detail').textContent).toContain('not a task duration');
    expect(find('.perf-facts').textContent).toContain('Since navigation2.40 s');
    await key(find('.perf-detail'), 'Escape');
    expect(host.querySelector('.perf-detail')).toBeNull();
    expect(document.activeElement).toBe(candidate);
  });

  it('keeps future observations explicit as the shared player seeks and the list is filtered', async () => {
    const { player, model } = await renderPerformance();
    const future = () => host.querySelectorAll('.perf-events [data-future]').length;
    expect(future()).toBe(model.signals.length);
    expect(find('.perf-events').textContent).toContain('Upcoming');
    await act(async () => player.seek(1700));
    expect(future()).toBe(3);
    await click(find('[aria-label="Search performance events"]'));
    const input = find<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'paint');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.perf-events .perf-event')).toHaveLength(2);
    expect(future()).toBe(1);
    await act(async () => player.seek(player.duration));
    expect(future()).toBe(0);
    await act(async () => player.seek(0));
    expect(future()).toBe(2);
  });

  it('windows a large event list and keyboard-selects an unmounted final event', async () => {
    const bundle = performanceFixture();
    bundle.network = [];
    bundle.steps = [];
    bundle.performance!.entries = Array.from({ length: 10000 }, (_, index) => ({ at: index, kind: 'long-task' as const, value: 1 }));
    const { player } = await renderPerformance(bundle);
    const list = find('[data-testid="performance-events"]');
    expect(list.querySelectorAll('.perf-event').length).toBeLessThan(40);
    await key(find('.perf-events .perf-event'), 'End');
    await act(async () => list.dispatchEvent(new Event('scroll')));
    await frames();
    expect(player.getTime()).toBe(9999);
    expect(document.activeElement).toBe(find('.perf-events [data-performance-id="performance-9999"]'));
    expect(list.querySelectorAll('.perf-event').length).toBeLessThan(40);
    await key(find('.perf-detail'), 'Escape');
    expect(document.activeElement).toBe(find('.perf-events [data-performance-id="performance-9999"]'));
  });

  it('shows honest legacy, API-unavailable, invalid-value and captured-zero states', async () => {
    const bundle = performanceFixture();
    delete bundle.performance;
    await renderPerformance(bundle);
    expect(host.textContent).toContain('Performance wasn’t recorded');
    bundle.performance = { supported: [], entries: [] };
    await renderPerformance(bundle);
    expect(host.textContent).toContain('Performance APIs unavailable');
    bundle.performance = { supported: ['longtask'], entries: [{ at: 1000, kind: 'long-task', value: NaN }] };
    await renderPerformance(bundle);
    expect(find('.perf-events').textContent).toContain('Unknown');
    expect(host.querySelector('.diagnostic-timing-span')).toBeNull();
    expect(find('.diagnostic-timing-point').hasAttribute('data-unknown')).toBe(true);
    bundle.performance.entries = [{ at: 1000, kind: 'long-task', value: 0 }];
    await renderPerformance(bundle);
    expect(find('.perf-events').textContent).toContain('0 ms');
  });

  it('keeps action points distinct from navigation milestones when following related evidence', async () => {
    await renderPerformance();
    await click(find('.perf-events [data-performance-id="performance-1"]'));
    const related = find('.perf-detail [data-performance-id="action-1"]');
    await click(related);
    expect(find('.perf-facts').textContent).toContain('Event timingPoint event');
    expect(find('.perf-facts').textContent).not.toContain('Since navigation');
    expect(find('.perf-detail h2').textContent).toBe('click: Open details');
    await key(find('.perf-detail'), 'Escape');
    expect(document.activeElement).toBe(find('.perf-filter'));
  });

  it('does not invent a duration for invalid paint metrics or discard a captured zero', async () => {
    const bundle = performanceFixture();
    bundle.steps = [];
    bundle.network = [];
    bundle.performance!.entries = [
      { at: 1000, kind: 'first-contentful-paint', value: -1 },
      { at: 1100, kind: 'largest-contentful-paint', value: 0 },
    ];
    await renderPerformance(bundle);
    expect(find('[data-performance-id="performance-0"] .perf-event-value').textContent).toBe('Unknown nav.');
    await click(find('[data-performance-id="performance-0"]'));
    expect(find('.perf-facts').textContent).toContain('Since navigationUnknown');
    await click(find('[data-performance-id="performance-1"]'));
    expect(find('.perf-facts').textContent).toContain('Since navigation0 ms');
    expect(find('.perf-detail').textContent).toContain('No related events captured here.');
  });

  it('integrates through Inspector with original edited evidence and existing redacted network details', async () => {
    const bundle = performanceFixture();
    bundle.network = [request({ at: 3500, duration: 1000, requestHeaders: [{ name: 'Authorization', value: '[REDACTED]' }] })];
    bundle.performance!.entries = [{ at: 3500, kind: 'long-task', value: 1000 }];
    const shown = applyEdits(bundle, waterfallEdits),
      player = new ReplayController(shown.bundle);
    function Harness() {
      const [tab, setTab] = useState<Parameters<typeof Inspector>[0]['tab']>('performance');
      const viewer = { setTab, setExpandedRequest: vi.fn<ViewerActions['setExpandedRequest']>() } as unknown as ViewerActions;
      return createElement(
        PlayerContext,
        { value: player },
        createElement(
          ViewerContext,
          { value: viewer },
          createElement(Inspector, {
            bundle: shown.bundle,
            sourceBundle: bundle,
            timeline: shown.timeline,
            tab,
            expandedRequest: undefined,
          }),
        ),
      );
    }
    const queries = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    await act(async () => root.render(createElement(QueryClientProvider, { client: queries }, createElement(Harness))));
    await click(find('.perf-events [data-performance-id="performance-0"]'));
    expect(player.getTime()).toBe(2000);
    await click(find('.perf-detail [data-performance-id="network-0"]'));
    expect(player.getTime()).toBe(2000);
    expect(find('.rd-grid').textContent).toContain('[REDACTED]');
    expect(find('.rd-grid').textContent).toContain('Request and response bodies are not retained');
    expect(find('[data-testid="network-tab"]')).toBeDefined();
  });
});
