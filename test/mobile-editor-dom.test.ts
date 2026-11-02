// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileInspector, MobileAddToolbar } from '../src/client/editor/MobileInspector.tsx';
import type { ReplayEdits } from '../src/shared/edits.ts';
import type { Selection } from '../src/client/editor/state.ts';

let root: Root;
let host: HTMLDivElement;
const change = vi.fn<(edits: ReplayEdits, selection?: Selection) => void>();
const range = vi.fn<(from: number, to: number) => void>();
const done = vi.fn<() => void>();
const remove = vi.fn<() => void>();
const cut = vi.fn<() => void>();
const highlight = vi.fn<() => void>();
const command = vi.fn<() => void>();
const edits: ReplayEdits = {
  version: 1,
  cuts: [],
  captions: [{ id: 'caption-1', from: 1000, to: 4000, text: 'Checkout' }],
  zooms: [{ id: 'zoom-1', from: 4000, to: 7000, scale: 1.8 }],
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderPanel(selection: Selection) {
  await act(async () =>
    root.render(
      createElement(MobileInspector, {
        edits,
        selection,
        duration: 10000,
        change,
        onSelectRange: range,
        onDone: done,
        onDelete: remove,
        onCut: cut,
        onPeriodHighlight: highlight,
        cursorOpen: false,
        placingBlur: false,
        effectControls: null,
        highlightControls: null,
        cursorInspector: null,
      }),
    ),
  );
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('selected mobile object properties', () => {
  it('renders no category pages or properties until an object is selected', async () => {
    await renderPanel(undefined);
    expect(host.childElementCount).toBe(0);
    await renderPanel({ kind: 'caption', id: 'caption-1' });
    expect(host.querySelector('h2')?.textContent).toBe('Caption');
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(2);
  });

  it('retimes the selected caption with existing edit mechanics and leaves other effects intact', async () => {
    const selection: Selection = { kind: 'caption', id: 'caption-1' };
    await renderPanel(selection);
    await input(host.querySelector<HTMLInputElement>('input')!, '2');
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        captions: [{ id: 'caption-1', from: 2000, to: 4000, text: 'Checkout' }],
        zooms: edits.zooms,
      }),
      selection,
    );
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="mobile-remove-object"]')!.click());
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => host.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(done).toHaveBeenCalledOnce();
  });

  it('distinguishes range selection, removing content and creating a highlight', async () => {
    await renderPanel({ kind: 'range', from: 1000, to: 4000 });
    await input(host.querySelector<HTMLInputElement>('input')!, '5');
    expect(range).toHaveBeenCalledWith(3900, 4000);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="cut-selection"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="add-period-highlight"]')!.click());
    expect(cut).toHaveBeenCalledOnce();
    expect(highlight).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain('Split');
  });

  it('closes the add overflow and restores its trigger after a command or Escape', async () => {
    await act(async () =>
      root.render(
        createElement(MobileAddToolbar, {
          onTrim: command,
          onCaption: command,
          onBlur: command,
          onZoom: command,
          more: [{ label: 'Highlight moment', action: command }],
        }),
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="More editing tools"]')!;
    await act(async () => trigger.click());
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(command).toHaveBeenCalledOnce();
    await act(async () => trigger.click());
    await act(async () =>
      document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
