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

afterEach(() => {
  act(() => {
    root.unmount();
  });
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

function key(name: string, shiftKey = false) {
  act(() => {
    seam().dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
  });
}

function pointer(type: string, clientY: number) {
  act(() => {
    seam().dispatchEvent(new PointerEvent(type, { clientY, button: 0, pointerId: 1, bubbles: true, cancelable: true }));
  });
}

describe('Splitter', () => {
  it('is a labelled, focusable horizontal separator reporting its size', () => {
    act(() => {
      root.render(createElement(Harness));
    });
    const element = seam();
    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
    expect(element.getAttribute('aria-label')).toBe('Resize panel');
    expect(element.getAttribute('aria-valuenow')).toBe('300');
    expect(element.getAttribute('aria-valuemax')).toBe('480');
    expect(element.tabIndex).toBe(0);
  });

  it('moves the line with the arrows (Shift for bigger steps), so ArrowUp grows a panel below it, and persists the size', () => {
    act(() => {
      root.render(createElement(Harness));
    });
    key('ArrowUp');
    key('ArrowDown', true);
    expect(changes).toEqual([316, 252]);
    expect(localStorage.getItem('test-split')).toBe('252');
  });

  it('keeps arrow keys from reaching the player shortcuts on the document', () => {
    act(() => {
      root.render(createElement(Harness));
    });
    const heard = vi.fn<(event: Event) => void>();
    document.addEventListener('keydown', heard);
    key('ArrowUp');
    document.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('jumps to its limits with Home and End', () => {
    act(() => {
      root.render(createElement(Harness));
    });
    key('Home');
    key('End');
    expect(changes).toEqual([120, 480]);
  });

  it('folds with Enter and reopens at the size it had', () => {
    act(() => {
      root.render(createElement(Harness, { initial: 340 }));
    });
    key('Enter');
    expect(folds).toEqual([true]);
    expect(seam().getAttribute('aria-valuenow')).toBe('0');
    key('Enter');
    expect(folds).toEqual([true, false]);
    expect(changes.at(-1)).toBe(340);
  });

  it('resets to its default on double-click', () => {
    act(() => {
      root.render(createElement(Harness, { initial: 400 }));
    });
    act(() => {
      seam().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(changes).toEqual([260]);
  });

  it('follows a drag, snaps near a snap point, and shows the resize cursor everywhere while held', () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    act(() => {
      root.render(createElement(Harness));
    });
    pointer('pointerdown', 500);
    expect(document.documentElement.dataset.splitterDrag).toBe('horizontal');
    pointer('pointermove', 535);
    pointer('pointerup', 535);
    expect(changes).toEqual([260]);
    expect(document.documentElement.dataset.splitterDrag).toBeUndefined();
  });

  it('folds a collapsible panel dragged well past its minimum', () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    act(() => {
      root.render(createElement(Harness));
    });
    pointer('pointerdown', 500);
    pointer('pointermove', 900);
    pointer('pointerup', 900);
    expect(folds).toEqual([true]);
    expect(changes).toEqual([]);
  });

  it('stops at its minimum when it cannot fold', () => {
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    act(() => {
      root.render(createElement(Harness, { collapsible: false }));
    });
    pointer('pointerdown', 500);
    pointer('pointermove', 900);
    pointer('pointerup', 900);
    expect(folds).toEqual([]);
    expect(changes).toEqual([120]);
  });
});
