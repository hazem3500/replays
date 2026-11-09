// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useViewState } from '../src/client/hooks/use-view-state.ts';
import { BUILT_IN_VIEWS, type ViewInfo } from '../src/shared/views.ts';
import { viewDefaults } from '../src/client/views/resolve.ts';

function view(id: string): ViewInfo {
  const preset = BUILT_IN_VIEWS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`no built-in view ${id}`);
  return { ...preset, order: 0 };
}

let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useViewState>;

function Probe({ id, onState }: { id: string; onState: (state: ReturnType<typeof useViewState>) => void }) {
  onState(useViewState(id, viewDefaults({ view: view(id) }), { fallbackTab: 'console' }));
  return null;
}

const render = (id: string) =>
  act(() => {
    root.render(
      createElement(Probe, {
        id,
        onState: (state) => {
          latest = state;
        },
      }),
    );
  });

describe('per-view settings', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    host = document.createElement('div');
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it('remembers a folded dock for the view it was folded in only', () => {
    render('standard');
    act(() => latest.setCollapsed(true));
    render('debug');
    expect(latest.collapsed).toBe(false);
    render('standard');
    expect(latest.collapsed).toBe(true);
  });

  it('opens a view on its preset tab until the person picks another there', () => {
    render('review');
    expect(latest.tab).toBe('comments');
    act(() => latest.setTab('context'));
    render('standard');
    render('review');
    expect(latest.tab).toBe('context');
  });

  it('forgets the view’s remembered settings on reset', () => {
    render('review');
    act(() => latest.setTab('context'));
    act(() => latest.reset());
    expect(latest.tab).toBe('comments');
  });

  it('keeps the captions choice across views, over each view’s default', () => {
    render('standard');
    const initial = latest.captions;
    act(() => latest.switchCaptions());
    render('debug');
    expect(latest.captions).toBe(!initial);
    act(() => latest.switchCaptions());
    render('standard');
    expect(latest.captions).toBe(initial);
  });

  it('falls back to the view default until a captions choice is stored, ignoring old per-view flags', () => {
    localStorage.setItem('replays-view:standard:captions', '1');
    render('standard');
    const preset = viewDefaults({ view: view('standard') }).captions;
    expect(latest.captions).toBe(preset);
    localStorage.setItem('replays-captions', preset ? '0' : '1');
    render('review');
    expect(latest.captions).toBe(!preset);
  });

  it('keeps the captions choice when a view is reset', () => {
    render('standard');
    act(() => latest.switchCaptions());
    const chosen = latest.captions;
    act(() => latest.reset());
    expect(latest.captions).toBe(chosen);
  });

  it('shows a hidden inspector once the person opens it', () => {
    render('walkthrough');
    expect(latest.hidden).toBe(true);
    act(() => latest.setCollapsed(false, false));
    expect(latest.hidden).toBe(false);
  });
});
