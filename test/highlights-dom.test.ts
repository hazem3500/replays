// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { Timeline } from '../src/client/editor/Timeline.tsx';
import type { ReplayEdits } from '../src/shared/edits.ts';
import type { EditorAction } from '../src/client/editor/state.ts';
import { must } from './must.ts';
import { settle } from './settle.ts';
import { stubRulerLayout } from './ruler-layout.ts';
import { waterfallFixture } from './waterfall-fixture.ts';

let root: Root;
let host: HTMLDivElement;
let restoreLayout: (() => void) | undefined;

describe('highlight timeline DOM', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    restoreLayout = stubRulerLayout();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: media.includes('pointer: coarse'),
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => {
      root.unmount();
    });
    host.remove();
    restoreLayout?.();
    vi.unstubAllGlobals();
  });

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
    await settle(() => {
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
            onCutRange: () => {},
          }),
        ),
      );
    });

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
    const [firstCenter = 0, secondCenter = 0] = targetCenters;
    const lastMarker = must(markers.at(2));
    expect(secondCenter - firstCenter).toBe(44);
    expect(lastMarker.style.getPropertyValue('--target-offset')).toBe('0px');
    expect(markers.slice(1).map((marker) => marker.getAttribute('data-edge'))).toEqual(['from', 'to']);
    expect(host.querySelector('.tl-highlight-band')).not.toBeNull();

    await settle(() => {
      lastMarker.click();
    });
    expect(player.getTime()).toBe(5000);
    expect(dispatch).toHaveBeenCalledWith({ type: 'select', selection: { kind: 'highlight', id: 'period' } });
  });
});
