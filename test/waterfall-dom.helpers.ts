import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { applyEdits } from '../src/shared/edits.ts';
import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { Waterfall } from '../src/client/viewer/Waterfall.tsx';
import { waterfallEdits } from './waterfall-fixture.ts';

export function findElement<T extends Element = HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector) ?? document.querySelector('.wf-filter-popover')?.querySelector<T>(selector);
  if (!element) throw new Error(`Missing waterfall element: ${selector}`);
  return element;
}
export async function click(element: HTMLElement) {
  await flushDom(() => element.click());
}
export async function key(element: HTMLElement, value: string) {
  await flushDom(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}
export async function chooseWaterfallFilter(host: HTMLElement, label: string, value: string) {
  if (!document.querySelector('.wf-filter-popover')) await click(findElement(host, '[data-testid="waterfall-filters"]'));
  const options = label === 'Waterfall state' ? '.wf-state-options' : '.wf-track-options';
  const option = [...findElement(host, options).querySelectorAll<HTMLButtonElement>('button')].find((button) => {
    const text = button.textContent?.trim().toLowerCase() ?? '';
    return (
      text === value ||
      (value === 'invalid' && text === 'unknown duration') ||
      (value === 'slow' && text.startsWith('slow')) ||
      (value === 'action' && text === 'actions') ||
      (value === 'all' && (text === 'all' || text === 'all requests'))
    );
  });
  if (!option) throw new Error(`Missing ${label} option: ${value}`);
  await click(option);
}
export async function inputValue(host: HTMLElement, element: HTMLInputElement, value: string) {
  if (element.closest('.wf-search-reveal')?.getAttribute('aria-hidden') === 'true')
    await click(findElement(host, '[data-testid="waterfall-search-toggle"]'));
  await flushDom(() => {
    // why: using the native setter bypasses React's value tracker so the input event reproduces a user's edit.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Native input value setter is unavailable');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
export async function renderTestWaterfall(root: Root, bundle: ReplayBundle, edited = false) {
  const shown = edited ? applyEdits(bundle, waterfallEdits) : undefined;
  const player = new ReplayController(shown?.bundle ?? bundle);
  const opened = vi.fn<(id: string) => void>();
  await flushDom(() =>
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

async function flushDom(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
