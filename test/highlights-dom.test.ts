// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { Timeline } from '../src/client/editor/Timeline.tsx';
import type { ReplayEdits } from '../src/shared/edits.ts';
import type { EditorAction } from '../src/client/editor/state.ts';
import { waterfallFixture } from './waterfall-fixture.ts';

let root: Root;
let host: HTMLDivElement;
let originalClientWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList?.contains('tl-ruler') ? 340 : 0;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media.includes('pointer: coarse'),
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  vi.unstubAllGlobals();
});

describe('highlight timeline DOM', () => {
  it('renders reachable, distinct period endpoints and offsets coincident touch targets', async () => {
    const player = new ReplayController(waterfallFixture());
    const edits: ReplayEdits = {
      version: 1,
      cuts: [],
      highlights: [
        { id: 'point', kind: 'point', at: 1000, label: 'Open' },
        { id: 'period', kind: 'period', from: 1000, to: 5000, label: 'Checkout' },
      ],
    };
    const dispatch = vi.fn<(action: EditorAction) => void>();
    await act(async () =>
      root.render(
        createElement(
          PlayerContext,
          { value: player },
          createElement(Timeline, {
            duration: 10_000,
            edits,
            selection: { kind: 'highlight', id: 'period' },
            dispatch,
            suggestions: [],
            onCutRange: () => undefined,
          }),
        ),
      ),
    );

    const markers = [...host.querySelectorAll<HTMLButtonElement>('.tl-highlight-marker')];
    expect(markers).toHaveLength(3);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'Point highlight: Open at 0:01.0',
      'Period highlight: Checkout at 0:01.0',
      'Period highlight: Checkout at 0:05.0',
    ]);
    const targetCenters = markers
      .slice(0, 2)
      .map((marker) => Number.parseFloat(marker.style.left) + Number.parseFloat(marker.style.getPropertyValue('--target-offset')));
    expect(targetCenters[1]! - targetCenters[0]!).toBe(44);
    expect(markers[2]!.style.getPropertyValue('--target-offset')).toBe('0px');
    expect(markers.slice(1).map((marker) => marker.getAttribute('data-edge'))).toEqual(['from', 'to']);
    expect(host.querySelector('.tl-highlight-band')).not.toBeNull();

    await act(async () => markers[2]!.click());
    expect(player.getTime()).toBe(5000);
    expect(dispatch).toHaveBeenCalledWith({ type: 'select', selection: { kind: 'highlight', id: 'period' } });
  });
});
