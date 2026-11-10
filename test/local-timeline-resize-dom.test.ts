// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LABEL_WIDTH_KEY, LocalTimeline } from '../src/client/viewer/LocalTimeline.tsx';

let root: Root;
let host: HTMLDivElement;

const items = [
  { id: 'a', label: 'Long task', at: 0, end: 200, value: '200 ms', current: true },
  { id: 'b', label: 'GET /api/x', at: 100, end: 300, value: '200 ms' },
];

function render() {
  act(() => {
    root.render(createElement(LocalTimeline, { from: 0, to: 400, origin: 0, items, label: 'Around this moment' }));
  });
}

const seam = () => host.querySelector<HTMLElement>('[data-testid="lt-label-seam"]')!;
const labelWidth = () => Number.parseInt(host.querySelector<HTMLElement>('.local-timeline')!.style.getPropertyValue('--lt-label'), 10);
const pointer = (type: string, clientX: number) =>
  act(() => {
    seam().dispatchEvent(new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true, cancelable: true }));
  });

describe('LocalTimeline label column', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('widens when its seam is dragged, within 25% to 75%, and keeps the width', () => {
    render();
    const start = labelWidth();
    pointer('pointerdown', 100);
    pointer('pointermove', 130);
    pointer('pointerup', 130);
    expect(labelWidth()).toBe(start + 30);
    expect(localStorage.getItem(LABEL_WIDTH_KEY)).toBe(String(start + 30));

    pointer('pointerdown', 100);
    pointer('pointermove', 5000);
    pointer('pointerup', 5000);
    expect(labelWidth()).toBe(480 - 226);

    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(labelWidth()).toBe(480 - 226);
  });

  it('moves with the arrow keys and resets on double-click', () => {
    render();
    const start = labelWidth();
    act(() => {
      seam().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(labelWidth()).toBe(start + 16);
    act(() => {
      seam().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(labelWidth()).toBe(start);
  });
});
