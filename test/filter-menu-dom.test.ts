// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterMenu, FilterSheet, type FilterState } from '../src/client/index/FilterMenu.tsx';

let host: HTMLDivElement;
let root: Root;

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

function item(text: string) {
  const element = [...document.querySelectorAll<HTMLElement>('[data-filter-menu] button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  expect(element).toBeDefined();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function nextFrame() {
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe('index filter panels', () => {
  it('moves focus into a phone facet and returns it to the facet row with Escape', async () => {
    const state: FilterState = {
      filters: {},
      kind: undefined,
      hosts: ['demo.example'],
      tags: [],
      update: vi.fn<FilterState['update']>(),
      setParam: vi.fn<FilterState['setParam']>(),
      setKind: vi.fn<FilterState['setKind']>(),
      clearFilters: vi.fn<FilterState['clearFilters']>(),
    };
    act(() => {
      root.render(createElement(FilterSheet, state));
    });
    await click(host.querySelector<HTMLElement>('.index-filters-button')!);
    await click([...document.querySelectorAll<HTMLElement>('.filter-sheet .filter-row')].find((row) => row.textContent?.includes('Host'))!);
    await nextFrame();
    const selected = document.querySelector<HTMLElement>('.filter-sheet [role="radio"][aria-checked="true"]')!;
    expect(document.activeElement).toBe(selected);

    act(() => {
      document
        .querySelector<HTMLElement>('.filter-sheet')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await nextFrame();
    expect(document.activeElement).toBe(
      [...document.querySelectorAll<HTMLElement>('.filter-sheet .filter-row')].find((row) => row.textContent?.includes('Host')),
    );
  });

  it('opens host choices inside the original panel and keeps other filters reachable after selection', async () => {
    const update = vi.fn<FilterState['update']>();
    const state: FilterState = {
      filters: {},
      kind: undefined,
      hosts: ['demo.example', '127.0.0.1'],
      tags: ['checkout'],
      update,
      setParam: vi.fn<FilterState['setParam']>(),
      setKind: vi.fn<FilterState['setKind']>(),
      clearFilters: vi.fn<FilterState['clearFilters']>(),
    };
    await act(async () => root.render(createElement(FilterMenu, state)));
    await click(host.querySelector<HTMLElement>('button')!);
    await click(item('Host'));
    expect(document.querySelectorAll('[data-filter-menu]')).toHaveLength(1);
    expect(document.querySelector('[data-filter-menu]')?.getAttribute('aria-label')).toBe('Filter by Host');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Search hosts"]')).not.toBeNull();
    expect(document.querySelector('.filter-choice-head')?.getAttribute('role')).toBeNull();
    await click(item('demo.example'));
    expect(update).toHaveBeenCalledWith('host', 'demo.example');
    expect(item('Source')).toBeDefined();
    expect(document.querySelectorAll('[data-filter-menu]')).toHaveLength(1);
  });

  it('uses Escape to return from a choice panel before closing the filter menu', async () => {
    const state: FilterState = {
      filters: {},
      kind: undefined,
      hosts: ['demo.example'],
      tags: [],
      update: vi.fn<FilterState['update']>(),
      setParam: vi.fn<FilterState['setParam']>(),
      setKind: vi.fn<FilterState['setKind']>(),
      clearFilters: vi.fn<FilterState['clearFilters']>(),
    };
    await act(async () => root.render(createElement(FilterMenu, state)));
    await click(host.querySelector<HTMLElement>('button')!);
    await click(item('Source'));
    const menu = document.querySelector<HTMLElement>('[data-filter-menu]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('[data-filter-menu]')?.getAttribute('aria-label')).toBe('Filters');
    expect(item('Host')).toBeDefined();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(item('Source'));
    const filters = document.querySelector<HTMLElement>('[data-filter-menu]')!;
    await act(async () => filters.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });
  it('focuses host search and offers a reset when no choices match', async () => {
    const state: FilterState = {
      filters: {},
      kind: undefined,
      hosts: ['demo.example'],
      tags: [],
      update: vi.fn<FilterState['update']>(),
      setParam: vi.fn<FilterState['setParam']>(),
      setKind: vi.fn<FilterState['setKind']>(),
      clearFilters: vi.fn<FilterState['clearFilters']>(),
    };
    await act(async () => root.render(createElement(FilterMenu, state)));
    await click(host.querySelector<HTMLElement>('button')!);
    await click(item('Host'));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search hosts"]')!;
    expect(document.activeElement).toBe(search);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'missing');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('No matching hosts');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    await click(item('Clear search'));
    expect(search.value).toBe('');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  });
});
