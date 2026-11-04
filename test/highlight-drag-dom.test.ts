// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { Timeline } from '../src/client/editor/Timeline.tsx';
import { type EditorAction, editorReducer, type EditorState, initialEditorState } from '../src/client/editor/state.ts';
import type { ReplayEdits, ReplayHighlight } from '../src/shared/edits.ts';
import { must } from './must.ts';
import { settle } from './settle.ts';
import { stubRulerLayout } from './ruler-layout.ts';
import { waterfallFixture } from './waterfall-fixture.ts';

const DURATION = 10_000;
/** The stubbed ruler is 340 px with 14 px of room each side: the clientX of a time on the track. */
const xAt = (time: number) => 14 + (time / DURATION) * 312;

let root: Root;
let host: HTMLDivElement;
let restoreLayout: (() => void) | undefined;

async function mount(highlights: ReplayHighlight[]) {
  const player = new ReplayController(waterfallFixture());
  let state: EditorState = initialEditorState({ version: 1, cuts: [], highlights } satisfies ReplayEdits);
  const render = () =>
    root.render(
      createElement(
        PlayerContext,
        { value: player },
        createElement(Timeline, {
          recording: { events: [], steps: [] },
          duration: DURATION,
          edits: state.present,
          selection: state.selection,
          dispatch,
          suggestions: [],
          onCutRange: () => {},
        }),
      ),
    );
  function dispatch(action: EditorAction) {
    state = editorReducer(state, action);
    render();
  }
  await settle(render);
  return { player, state: () => state, highlight: () => must(state.present.highlights?.[0]) };
}

/** One time of a highlight: a point's `at`, or a period's `from` or `to`. */
function timeOf(highlight: ReplayHighlight, field: 'at' | 'from' | 'to') {
  if (highlight.kind === 'point') return field === 'at' ? highlight.at : Number.NaN;
  if (field === 'from') return highlight.from;
  return field === 'to' ? highlight.to : Number.NaN;
}

const markers = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="timeline-highlight"]')];
const pointer = (type: string, clientX: number) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });

/** Presses on `target` at `from`, moves through the points in `to`, then releases on the window. */
async function drag(target: Element, from: number, ...to: number[]) {
  await settle(() => {
    target.dispatchEvent(pointer('pointerdown', xAt(from)));
  });
  for (const time of to)
    await settle(() => {
      window.dispatchEvent(pointer('pointermove', xAt(time)));
    });
  await settle(() => {
    window.dispatchEvent(pointer('pointerup', xAt(to.at(-1) ?? from)));
  });
}

describe('dragging highlights on the timeline', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    restoreLayout = stubRulerLayout();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
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

  it('moves a point highlight to where its marker is dropped, as one undo step', async () => {
    const editor = await mount([{ id: 'point', kind: 'point', at: 2000 }]);
    await drag(must(markers()[0]), 2000, 3000, 4000);
    expect(timeOf(editor.highlight(), 'at')).toBeCloseTo(4000, -2);
    expect(editor.state().past).toHaveLength(1);
    expect(editor.state().selection).toEqual({ kind: 'highlight', id: 'point' });
  });

  it('resizes a period from its end marker and leaves its start in place', async () => {
    const editor = await mount([{ id: 'period', kind: 'period', from: 1000, to: 3000 }]);
    await drag(must(markers()[1]), 3000, 6000);
    expect(timeOf(editor.highlight(), 'from')).toBe(1000);
    expect(timeOf(editor.highlight(), 'to')).toBeCloseTo(6000, -2);
  });

  it('stops a period’s start marker the minimum length short of its end', async () => {
    const editor = await mount([{ id: 'period', kind: 'period', from: 1000, to: 3000 }]);
    await drag(must(markers()[0]), 1000, 8000);
    expect(editor.highlight()).toMatchObject({ from: 2900, to: 3000 });
  });

  it('moves a whole period by its band and keeps its length', async () => {
    const editor = await mount([{ id: 'period', kind: 'period', from: 1000, to: 3000 }]);
    await drag(must(host.querySelector('[data-testid="timeline-highlight-band"]')), 2000, 5000);
    expect(timeOf(editor.highlight(), 'to') - timeOf(editor.highlight(), 'from')).toBe(2000);
    expect(timeOf(editor.highlight(), 'from')).toBeCloseTo(4000, -2);
  });

  it('nudges a focused marker with the arrows, a second at a time with Shift', async () => {
    const editor = await mount([{ id: 'point', kind: 'point', at: 2000 }]);
    const marker = must(markers()[0]);
    await settle(() => {
      marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    await settle(() => {
      must(markers()[0]).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(editor.highlight()).toMatchObject({ at: 3100 });
    expect(editor.state().past).toHaveLength(2);
  });

  it('selects and seeks on a click without movement, leaving the highlight where it was', async () => {
    const editor = await mount([{ id: 'point', kind: 'point', at: 2000 }]);
    const marker = must(markers()[0]);
    await drag(marker, 2000);
    await settle(() => {
      marker.click();
    });
    expect(editor.state().selection).toEqual({ kind: 'highlight', id: 'point' });
    expect(editor.player.getTime()).toBe(2000);
    expect(editor.highlight()).toMatchObject({ at: 2000 });
    expect(editor.state().past).toHaveLength(0);
  });
});
