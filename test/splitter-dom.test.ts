// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Splitter } from '../src/client/components/ui/splitter.tsx';

let root: Root;
let host: HTMLDivElement;
let changes: number[];
let folds: boolean[];

function setUp() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  changes = [];
  folds = [];
}

function tearDown() {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

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

function seam() {
  const element = host.querySelector<HTMLElement>('[data-testid="seam"]');
  if (!element) throw new Error('the splitter is not rendered');
  return element;
}

function render(props: { initial?: number; collapsible?: boolean } = {}) {
  act(() => {
    root.render(createElement(Harness, props));
  });
}

/** happy-dom has no pointer capture; the splitter only needs the call to succeed. */
function capturePointers() {
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
}

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

describe('Splitter from the keyboard', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('is a labelled, focusable horizontal separator reporting its size', () => {
    render();
    const element = seam();
    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-orientation')).toBe('horizontal');
    expect(element.getAttribute('aria-label')).toBe('Resize panel');
    expect(element.getAttribute('aria-valuenow')).toBe('300');
    expect(element.getAttribute('aria-valuemax')).toBe('480');
    expect(element.tabIndex).toBe(0);
  });

  it('moves the line with the arrows (Shift for bigger steps), so ArrowUp grows a panel below it, and persists the size', () => {
    render();
    key('ArrowUp');
    key('ArrowDown', true);
    expect(changes).toEqual([316, 252]);
    expect(localStorage.getItem('test-split')).toBe('252');
  });

  it('keeps arrow keys from reaching the player shortcuts on the document', () => {
    render();
    const heard = vi.fn<(event: Event) => void>();
    document.addEventListener('keydown', heard);
    key('ArrowUp');
    document.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('jumps to its limits with Home and End', () => {
    render();
    key('Home');
    key('End');
    expect(changes).toEqual([120, 480]);
  });

  it('folds with Enter and reopens at the size it had', () => {
    render({ initial: 340 });
    key('Enter');
    expect(folds).toEqual([true]);
    expect(seam().getAttribute('aria-valuenow')).toBe('0');
    key('Enter');
    expect(folds).toEqual([true, false]);
    expect(changes.at(-1)).toBe(340);
  });

  it('resets to its default on double-click', () => {
    render({ initial: 400 });
    act(() => {
      seam().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(changes).toEqual([260]);
  });
});

describe('Splitter under the pointer', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('follows a drag, snaps near a snap point, and shows the resize cursor everywhere while held', () => {
    capturePointers();
    render();
    pointer('pointerdown', 500);
    expect(document.documentElement.dataset.splitterDrag).toBe('horizontal');
    pointer('pointermove', 535);
    pointer('pointerup', 535);
    expect(changes).toEqual([260]);
    expect(document.documentElement.dataset.splitterDrag).toBeUndefined();
  });

  it('folds a collapsible panel dragged well past its minimum', () => {
    capturePointers();
    render();
    pointer('pointerdown', 500);
    pointer('pointermove', 900);
    pointer('pointerup', 900);
    expect(folds).toEqual([true]);
    expect(changes).toEqual([]);
  });

  it('stops at its minimum when it cannot fold', () => {
    capturePointers();
    render({ collapsible: false });
    pointer('pointerdown', 500);
    pointer('pointermove', 900);
    pointer('pointerup', 900);
    expect(folds).toEqual([]);
    expect(changes).toEqual([120]);
  });
});
