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
function button(text: string) {
  const element = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text));
  expect(element).toBeDefined();
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
  it('selects a metric, seeks the existing player and opens related request details without losing event access', async () => {
    const { player } = await renderPerformance();
    const main = find('[data-testid="performance-main"]');
    await click(button('Longest recorded task'));
    expect(player.getTime()).toBe(1700);
    expect(find('.perf-detail').textContent).toContain('420 ms measured');
    expect(find('.perf-detail').textContent).toContain('do not establish the cause');
    expect(find('[data-testid="performance-main"]')).toBe(main);
    await click(find('.perf-detail [data-performance-id="network-0"]'));
    expect(player.getTime()).toBe(1600);
    expect(find('[data-network-detail="req"]').textContent).toContain('/api/projects');
    expect(find('.perf-main').contains(button('Longest recorded task'))).toBe(true);
  });

  it('draws edited span endpoints and seeks the retained portion of a task whose start was cut', async () => {
    const bundle = performanceFixture();
    bundle.performance!.entries = [{ at: 3500, kind: 'long-task', value: 1000 }];
    const { player } = await renderPerformance(bundle, true);
    const bar = find('.perf-span[data-performance-id="performance-0"]');
    expect(bar.style.left).toBe('40%');
    expect(bar.style.width).toBe('5%');
    await click(find('[data-lane="tasks"] .perf-lane'));
    expect(player.duration).toBe(5000);
    expect(player.getTime()).toBe(2000);
    expect(find('.perf-detail').textContent).toContain('1.00 s measured');
    expect(find('.perf-detail').textContent).toContain('250 ms visible in this replay');
    await click(button('Zoom to selection'));
    expect(find('[role="slider"]').getAttribute('aria-valuemin')).toBe('1000');
    expect(find('[role="slider"]').getAttribute('aria-valuemax')).toBe('3250');
    await click(button('Full recording'));
    expect(find('[role="slider"]').getAttribute('aria-valuemax')).toBe('5000');
  });

  it('scrubs the shared player using pointer capture and keyboard controls without a second range input', async () => {
    const { player } = await renderPerformance();
    const axis = find('[role="slider"]');
    const captured = new Set<number>();
    axis.setPointerCapture = (id) => {
      captured.add(id);
    };
    axis.hasPointerCapture = (id) => captured.has(id);
    axis.releasePointerCapture = (id) => {
      captured.delete(id);
    };
    vi.spyOn(axis, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 500 } as DOMRect);
    await act(async () => axis.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 350, bubbles: true })));
    expect(player.getTime()).toBe(5000);
    await act(async () => axis.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 700, bubbles: true })));
    expect(player.getTime()).toBe(10000);
    await act(async () => axis.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
    expect(captured.size).toBe(0);
    const global = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener('keydown', global);
    await key(axis, 'Home');
    expect(player.getTime()).toBe(0);
    await key(axis, 'ArrowRight');
    expect(player.getTime()).toBe(100);
    await key(axis, 'End');
    await key(axis, 'ArrowLeft');
    expect(player.getTime()).toBe(9900);
    expect(global).not.toHaveBeenCalled();
    document.removeEventListener('keydown', global);
    await act(async () => player.seek(3500));
    expect(find('[data-testid="performance-playhead"]').style.left).toBe('35%');
    expect(host.querySelector('input[type="range"]')).toBeNull();
  });

  it('searches All events, labels paint values from navigation and restores selection focus on Escape', async () => {
    const { player } = await renderPerformance();
    await click(button('All events'));
    const input = find<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'paint');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(find('.perf-events').querySelectorAll('.perf-event')).toHaveLength(2);
    const candidate = find('.perf-events [data-performance-id="performance-3"]');
    expect(candidate.textContent).toContain('2.40 s from navigation');
    await click(candidate);
    expect(player.getTime()).toBe(2400);
    expect(find('.perf-detail').textContent).toContain('not a task duration');
    await key(find('.perf-detail'), 'Escape');
    expect(host.querySelector('.perf-detail')).toBeNull();
    expect(document.activeElement).toBe(candidate);
  });

  it('keeps future observations explicit as the shared player seeks and the list is filtered', async () => {
    const { player, model } = await renderPerformance();
    await click(button('All events'));
    const future = () => host.querySelectorAll('.perf-events [data-future]').length;
    expect(future()).toBe(model.signals.length);
    expect(find('.perf-events').textContent).toContain('Upcoming');
    await act(async () => player.seek(1700));
    expect(future()).toBe(3);
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

  it('uses one lane control for dense marks while preserving direct selection and keyboard event seeking', async () => {
    const { player } = await renderPerformance();
    const lane = find('[data-lane="tasks"] .perf-lane');
    expect(lane.tagName).toBe('BUTTON');
    expect(lane.querySelectorAll('button')).toHaveLength(0);
    expect(lane.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    await click(lane);
    expect(player.getTime()).toBe(1700);
    await key(lane, 'End');
    expect(player.getTime()).toBe(2800);
    expect(find('.perf-detail').textContent).toContain('90 ms measured');
    await click(find('.perf-span[data-performance-id="performance-1"]'));
    expect(player.getTime()).toBe(1700);
    await key(lane, 'Escape');
    expect(host.querySelector('.perf-detail')).toBeNull();
    expect(document.activeElement).toBe(lane);
  });

  it('windows a large event list and keyboard-selects an unmounted final event', async () => {
    const bundle = performanceFixture();
    bundle.network = [];
    bundle.steps = [];
    bundle.performance!.entries = Array.from({ length: 10000 }, (_, index) => ({ at: index, kind: 'long-task' as const, value: 1 }));
    const { player } = await renderPerformance(bundle);
    expect(host.querySelectorAll('.perf-span').length).toBe(160);
    expect(host.textContent).toContain('9840 marks omitted');
    await click(button('All events'));
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
    expect(button('Longest recorded task').textContent).toContain('Invalid / unknown');
    expect(host.querySelector('.perf-span[data-performance-id="performance-0"]')).toBeNull();
    expect(find('.perf-point').hasAttribute('data-unknown')).toBe(true);
    bundle.performance.entries = [{ at: 1000, kind: 'long-task', value: 0 }];
    await renderPerformance(bundle);
    expect(button('Longest recorded task').textContent).toContain('0 ms');
    expect(button('Longest recorded task').disabled).toBe(false);
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
    await click(button('Longest recorded task'));
    expect(player.getTime()).toBe(2000);
    await click(find('.perf-detail [data-performance-id="network-0"]'));
    expect(player.getTime()).toBe(2000);
    expect(find('.rd-grid').textContent).toContain('[REDACTED]');
    expect(find('.rd-grid').textContent).toContain('Request and response bodies are not retained');
    expect(find('[data-testid="network-tab"]')).toBeDefined();
  });
});
