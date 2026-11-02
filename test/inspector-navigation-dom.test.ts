// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlotRegistry } from '../src/client/plugins/slots.ts';
import { InspectorCollapseButton, InspectorNavigation } from '../src/client/viewer/InspectorNavigation.tsx';
import { inspectorTabItems, type InspectorTabContext, type TabResolver } from '../src/client/viewer/inspector-tabs.tsx';

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

const CONTEXT: InspectorTabContext = {
  stepCount: 2,
  summaries: {
    console: { total: 2, problems: 1, problemKind: 'error', problemLabel: '1 error' },
    network: { total: 4, problems: 1, problemKind: 'failed', problemLabel: '1 failed' },
    performance: { total: 0, problems: 0, problemKind: 'warning', problemLabel: '' },
  },
  plugins: [{ key: 'plugin:sample:activity', label: 'Activity' }],
};

/** The registry's real merge, as the ready Inspector uses it (plugin items carry the legacy +1000 base). */
function registryResolver(configure?: (slot: SlotRegistry<InspectorTabContext, unknown>) => void): TabResolver {
  const slot = new SlotRegistry<InspectorTabContext, unknown>('viewer.inspector.tabs');
  slot.register({ id: 'plugin:sample:activity', order: 1000, render: () => undefined });
  configure?.(slot);
  return (_name, builtins, context) => slot.resolve(context, builtins as never) as never;
}

async function renderNavigation(items = inspectorTabItems(CONTEXT, registryResolver()), initial = 'network') {
  function Harness() {
    const [activePanel, setActivePanel] = useState(initial);
    return createElement(InspectorNavigation, { items, activePanel, onPanelChange: setActivePanel });
  }
  await act(async () => root.render(createElement(Harness)));
}

async function press(element: HTMLElement, key: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

describe('inspector tab descriptors', () => {
  it('orders built-ins as core:* descriptors, then plugin tabs, with Steps only when there are steps', () => {
    const items = inspectorTabItems(CONTEXT, registryResolver());
    expect(items.map((item) => item.slotId)).toEqual([
      'core:steps',
      'core:issues',
      'core:console',
      'core:network',
      'core:performance',
      'core:context',
      'plugin:sample:activity',
    ]);
    expect(items.map((item) => item.group)).toEqual(['journey', 'issues', 'diagnostics', 'diagnostics', 'diagnostics', 'context', 'more']);
    expect(inspectorTabItems({ stepCount: 0 }).map((item) => item.id)).toEqual(['issues', 'console', 'network', 'performance', 'context']);
  });

  it('gives steps one home: no Steps tab while the steps rail is on screen', () => {
    expect(inspectorTabItems({ stepCount: 3, rail: true }).map((item) => item.id)).not.toContain('steps');
  });

  it('gives a tab one total badge, tinted by its problems, and none at zero', () => {
    const byId = Object.fromEntries(inspectorTabItems(CONTEXT).map((item) => [item.id, item]));
    expect(byId.steps?.badge).toEqual({ value: 2, label: '2 steps' });
    expect(byId.console?.badge).toEqual({ value: 2, tone: 'danger', label: '2 entries, 1 error' });
    expect(byId.network?.badge).toEqual({ value: 4, tone: 'danger', label: '4 requests, 1 failed' });
    expect(byId.performance?.badge).toBeUndefined();
    const poor = inspectorTabItems({ stepCount: 0, summaries: { performance: { total: 3, problems: 2, problemKind: 'warning', problemLabel: '2 poor' } } });
    expect(poor.find((item) => item.id === 'performance')?.badge).toEqual({ value: 3, tone: 'warning', label: '3 signals, 2 poor' });
  });

  it('honours the slot configuration: hidden and reordered tabs', () => {
    const items = inspectorTabItems(CONTEXT, registryResolver((slot) => slot.configure({ order: ['core:network'], hide: ['core:performance'] })));
    expect(items.map((item) => item.id)).toEqual(['network', 'steps', 'issues', 'console', 'context', 'plugin:sample:activity']);
  });
});

describe('inspector tab row', () => {
  it('renders one tablist with slot attributes, group hairlines and descriptive names', async () => {
    await renderNavigation();
    expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(host.querySelector('.inspector-navigation')?.getAttribute('data-slot')).toBe('viewer.inspector.tabs');
    const network = host.querySelector<HTMLElement>('#network-tab')!;
    expect(network.getAttribute('aria-selected')).toBe('true');
    expect(network.getAttribute('aria-controls')).toBe('network-panel');
    expect(network.getAttribute('aria-label')).toBe('Network, 4 requests, 1 failed');
    expect(network.getAttribute('data-slot-item')).toBe('core:network');
    expect(network.querySelector('.inspector-navigation-count')?.textContent).toBe('4');
    expect(network.querySelector('.inspector-navigation-count')?.getAttribute('data-tone')).toBe('danger');
    expect(host.querySelector('#performance-tab .inspector-navigation-count')).toBeNull();
    const starts = [...host.querySelectorAll('[role="tab"][data-group-start]')].map((tab) => tab.id);
    expect(starts).toEqual(['issues-tab', 'console-tab', 'context-tab', 'plugin:sample:activity-tab']);
    expect(host.textContent).not.toMatch(/\bof\b/);
    // Nothing spills in a row wide enough (happy-dom lays nothing out), so "More" stays out of reach.
    expect(host.querySelector('[data-testid="inspector-more"]')?.hasAttribute('data-empty')).toBe(true);
  });

  it('moves focus and selection with arrow keys without bubbling seek keys to the player', async () => {
    await renderNavigation();
    let bubbled = false;
    const observe = () => {
      bubbled = true;
    };
    document.addEventListener('keydown', observe);
    const context = host.querySelector<HTMLButtonElement>('#context-tab')!;
    context.focus();
    await press(context, 'ArrowLeft');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('performance-tab');
    expect(document.activeElement).toBe(host.querySelector('#performance-tab'));
    await press(document.activeElement as HTMLElement, 'End');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('plugin:sample:activity-tab');
    expect(bubbled).toBe(false);
    document.removeEventListener('keydown', observe);
  });

  it('labels the fold control by what it does', async () => {
    const changes: boolean[] = [];
    await act(async () =>
      root.render(createElement(InspectorCollapseButton, { collapsed: false, onCollapsedChange: (next: boolean) => changes.push(next) })),
    );
    const button = host.querySelector<HTMLButtonElement>('[data-testid="inspector-collapse"]')!;
    expect(button.getAttribute('aria-label')).toBe('Hide panel');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await act(async () => button.click());
    expect(changes).toEqual([true]);
    await act(async () => root.render(createElement(InspectorCollapseButton, { collapsed: true, onCollapsedChange: () => undefined })));
    expect(host.querySelector('[data-testid="inspector-collapse"]')?.getAttribute('aria-label')).toBe('Show panel');
  });
});

/** A 450 px row of 100 px tabs and a 60 px "More" (happy-dom lays nothing out, so the browser's sizes are stubbed). */
function layOut() {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tab' ? 100 : this.classList.contains('inspector-navigation-more') ? 60 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tablist' ? 450 : 0;
  });
}

describe('tab row overflow', () => {
  it('keeps every tab in the row when they fit', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(450);
    await renderNavigation();
    expect(host.querySelectorAll('[role="tab"][data-overflowed]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="inspector-more"]')?.hasAttribute('data-empty')).toBe(true);
  });

  it('moves the tabs that do not fit behind "More", in order, and never the active one', async () => {
    layOut();
    await renderNavigation(undefined, 'plugin:sample:activity');
    const spilled = [...host.querySelectorAll('[role="tab"][data-overflowed]')].map((tab) => tab.id);
    expect(spilled).toEqual(['console-tab', 'network-tab', 'performance-tab', 'context-tab']);
    expect(host.querySelector('#plugin\\:sample\\:activity-tab')?.hasAttribute('data-overflowed')).toBe(false);
    const more = host.querySelector('[data-testid="inspector-more"]')!;
    expect(more.hasAttribute('data-empty')).toBe(false);
    expect(more.getAttribute('aria-label')).toBe('4 more panels');
  });
});
