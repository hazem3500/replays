// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { betaGroupedInspector } from '../src/client/config.ts';
import {
  buildInspectorNavigationModel,
  INSPECTOR_NAVIGATION_LAYOUT_KEY,
  InspectorNavigation,
  useInspectorNavigationLayout,
} from '../src/client/viewer/InspectorNavigation.tsx';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.querySelector('meta[name="app-beta"]')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function chooseLayout(layout: 'direct' | 'grouped') {
  localStorage.setItem(INSPECTOR_NAVIGATION_LAYOUT_KEY, layout);
  await act(async () => window.dispatchEvent(new Event('storage')));
}

async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

async function press(element: HTMLElement, key: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

async function renderNavigation({ beta = true, initial = 'network' }: { beta?: boolean; initial?: string } = {}) {
  const model = buildInspectorNavigationModel({
    stepCount: 2,
    counts: {
      steps: { value: 1, total: 2, noun: 'step', plural: 'steps' },
      network: { value: 3, total: 19, noun: 'request', plural: 'requests' },
    },
    extraItems: [{ id: 'plugin:sample:activity', label: 'Activity', kind: 'plugin' }],
  });
  function Harness() {
    const [activePanel, setActivePanel] = useState(initial);
    const { layout, setLayout } = useInspectorNavigationLayout(beta);
    return createElement(InspectorNavigation, {
      ...model,
      activePanel,
      onPanelChange: setActivePanel,
      layout,
      onLayoutChange: setLayout,
      betaEnabled: beta,
    });
  }
  await act(async () => root.render(createElement(Harness)));
}

describe('shared Inspector navigation', () => {
  it('builds the canonical labels, icons, optional Journey and only real More panels', () => {
    const model = buildInspectorNavigationModel({ stepCount: 1 });
    expect(model.groups.map(({ id }) => id)).toEqual(['journey', 'diagnostics', 'context']);
    expect(model.items.map(({ id, label }) => [id, label])).toEqual([
      ['steps', 'Steps'],
      ['console', 'Console'],
      ['network', 'Network'],
      ['performance', 'Performance'],
      ['context', 'Context'],
    ]);
    expect(model.items.every((item) => item.icon)).toBe(true);
    expect(buildInspectorNavigationModel().groups.map(({ id }) => id)).toEqual(['diagnostics', 'context']);
    const withPlugin = buildInspectorNavigationModel({ extraItems: [{ id: 'plugin:a:b', label: 'A panel', kind: 'plugin' }] });
    expect(withPlugin.groups.map(({ id }) => id)).toContain('more');
  });

  it('keeps the active leaf while switching layout and selects another group with its default panel', async () => {
    await renderNavigation();
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Diagnostics panels');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('network-tab');
    expect(host.querySelector('#network-tab')?.getAttribute('aria-controls')).toBe('network-panel');
    expect(host.querySelector('#network-tab')?.getAttribute('aria-label')).toContain('3 of 19 requests');
    await chooseLayout('direct');
    expect(localStorage.getItem(INSPECTOR_NAVIGATION_LAYOUT_KEY)).toBe('direct');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('network-tab');
    await chooseLayout('grouped');
    expect(localStorage.getItem(INSPECTOR_NAVIGATION_LAYOUT_KEY)).toBe('grouped');
    await click('[data-testid="inspector-group-context"]');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('context-tab');
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Context panels');
  });

  it('defaults direct without beta, persists a chosen layout, and tolerates blocked storage', async () => {
    localStorage.setItem(INSPECTOR_NAVIGATION_LAYOUT_KEY, 'grouped');
    await renderNavigation({ beta: false });
    expect(host.querySelector('.inspector-layout-choice')).toBeNull();
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Replay panels');
    await act(async () => root.unmount());

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    root = createRoot(host);
    await renderNavigation();
    expect(host.querySelector('.inspector-navigation')?.getAttribute('data-layout')).toBe('grouped');
    expect(host.querySelector('.inspector-layout-choice')).toBeNull();
  });

  it('moves focus and selection with arrow keys without bubbling seek keys to the player', async () => {
    await renderNavigation();
    const group = host.querySelector<HTMLButtonElement>('[data-testid="inspector-group-diagnostics"]')!;
    let bubbled = false;
    const observe = () => {
      bubbled = true;
    };
    document.addEventListener('keydown', observe);
    group.focus();
    await press(group, 'ArrowRight');
    expect(host.querySelector('[data-testid="inspector-group-context"]')).toBe(document.activeElement);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('context-tab');
    expect(bubbled).toBe(false);
    await chooseLayout('direct');
    const context = host.querySelector<HTMLButtonElement>('#context-tab')!;
    context.focus();
    await press(context, 'ArrowLeft');
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('performance-tab');
    expect(document.activeElement).toBe(host.querySelector('#performance-tab'));
    document.removeEventListener('keydown', observe);
  });

  it('reads the beta meta token with whitespace-separated flags', () => {
    const meta = document.createElement('meta');
    meta.name = 'app-beta';
    meta.content = 'editor grouped-inspector malleable';
    document.head.append(meta);
    expect(betaGroupedInspector()).toBe(true);
    meta.content = 'editor,malleable';
    expect(betaGroupedInspector()).toBe(false);
  });
});
