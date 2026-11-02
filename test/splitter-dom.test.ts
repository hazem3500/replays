// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Splitter } from '../src/client/components/ui/splitter.tsx';

let root: Root;
let host: HTMLDivElement;
let changes: number[];
let folds: boolean[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  changes = [];
  folds = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Harness({ initial = 300, collapsible = true }: { initial?: number; collapsible?: boolean }) {
  const [value, setValue] = useState(initial);
  const [collapsed, setCollapsed] = useState(false);
  return createElement(Splitter, {
    orientation: 'horizontal',
    side: 'end',
    value,
    min: 120,
    max: 480,
    defaultValue: 260,
    snapPoints: [260],
    collapsible,
    collapsed,
    onChange: (size: number) => {
      changes.push(size);
      setValue(size);
    },
    onCollapsedChange: (next: boolean) => {
      folds.push(next);
      setCollapsed(next);
    },
    storageKey: 'test-split',
    label: 'Resize panel',
    testId: 'seam',
  });
}

const seam = () => host.querySelector<HTMLElement>('[data-testid="seam"]')!;

async function key(name: string, shiftKey = false) {
  await act(async () => seam().dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })));
}

async function pointer(type: string, clientY: number) {
  await act(async () => seam().dispatchEvent(new PointerEvent(type, { clientY, button: 0, pointerId: 1, bubbles: true, cancelable: true })));
}

describe('Splitter', () => {
  it('is a labelled, focusable horizontal separator reporting its size', async () => {
    await act(async () => root.render(createElement(Harness)));
    const element = seam();
    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
    expect(element.getAttribute('aria-label')).toBe('Resize panel');
    expect(element.getAttribute('aria-valuenow')).toBe('300');
    expect(element.getAttribute('aria-valuemax')).toBe('480');
    expect(element.tabIndex).toBe(0);
  });

  it('moves the line with the arrows (Shift for bigger steps), so ArrowUp grows a panel below it, and persists the size', async () => {
    await act(async () => root.render(createElement(Harness)));
    await key('ArrowUp');
    await key('ArrowDown', true);
    expect(changes).toEqual([316, 252]);
    expect(localStorage.getItem('test-split')).toBe('252');
  });

  it('keeps arrow keys from reaching the player shortcuts on the document', async () => {
    await act(async () => root.render(createElement(Harness)));
    const heard = vi.fn<(event: Event) => void>();
    document.addEventListener('keydown', heard);
    await key('ArrowUp');
    document.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('jumps to its limits with Home and End', async () => {
    await act(async () => root.render(createElement(Harness)));
    await key('Home');
    await key('End');
    expect(changes).toEqual([120, 480]);
  });

  it('folds with Enter and reopens at the size it had', async () => {
    await act(async () => root.render(createElement(Harness, { initial: 340 })));
    await key('Enter');
    expect(folds).toEqual([true]);
    expect(seam().getAttribute('aria-valuenow')).toBe('0');
    await key('Enter');
    expect(folds).toEqual([true, false]);
    expect(changes.at(-1)).toBe(340);
  });

  it('resets to its default on double-click', async () => {
    await act(async () => root.render(createElement(Harness, { initial: 400 })));
    await act(async () => seam().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(changes).toEqual([260]);
  });

  it('follows a drag, snaps near a snap point, and shows the resize cursor everywhere while held', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    await act(async () => root.render(createElement(Harness)));
    await pointer('pointerdown', 500);
    expect(document.documentElement.dataset.splitterDrag).toBe('horizontal');
    await pointer('pointermove', 535);
    await pointer('pointerup', 535);
    expect(changes).toEqual([260]);
    expect(document.documentElement.dataset.splitterDrag).toBeUndefined();
  });

  it('folds a collapsible panel dragged well past its minimum', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    await act(async () => root.render(createElement(Harness)));
    await pointer('pointerdown', 500);
    await pointer('pointermove', 900);
    await pointer('pointerup', 900);
    expect(folds).toEqual([true]);
    expect(changes).toEqual([]);
  });

  it('stops at its minimum when it cannot fold', async () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    await act(async () => root.render(createElement(Harness, { collapsible: false })));
    await pointer('pointerdown', 500);
    await pointer('pointermove', 900);
    await pointer('pointerup', 900);
    expect(folds).toEqual([]);
    expect(changes).toEqual([120]);
  });
});
