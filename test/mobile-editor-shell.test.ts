// @vitest-environment happy-dom
import { createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Editor } from '../src/client/editor/Editor.tsx';
import { saveEdits, type LoadedEdits } from '../src/client/edits.ts';
import type * as editsModule from '../src/client/edits.ts';
import { navigate } from '../src/client/routing/navigate.ts';
import type * as navigationModule from '../src/client/routing/navigate.ts';
import { type Playback, usePlayer } from '../src/client/player.ts';
import { must } from './must.ts';
import { settle } from './settle.ts';
import { stubRulerLayout } from './ruler-layout.ts';
import { waterfallFixture } from './waterfall-fixture.ts';

// why: motion rendering is covered in browser checks; happy-dom rejects canceled WAAPI promises.
vi.mock('../src/client/components/animated-icon.tsx', () => ({ AnimatedIcon: () => createElement('svg', { 'aria-hidden': true }) }));

let player: Playback | undefined;
function TestStage() {
  const current = usePlayer();
  useEffect(() => {
    player = current;
  }, [current]);
  return createElement('div', { className: 'player-stage' });
}
vi.mock('../src/client/viewer/Transport.tsx', () => ({ PlayerStage: TestStage }));
vi.mock('../src/client/Topbar.tsx', () => ({ Topbar: () => createElement('header', { 'data-testid': 'desktop-topbar' }) }));
vi.mock('../src/client/editor/EditorExport.tsx', () => ({
  EditorExport: ({ dirty, saving }: { dirty: boolean; saving: boolean }) =>
    createElement(
      'button',
      {
        'data-testid': 'editor-export',
        disabled: dirty || saving,
      },
      'Export',
    ),
}));
vi.mock('../src/client/routing/navigate.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof navigationModule>()),
  navigate: vi.fn<typeof navigate>(),
}));
vi.mock('../src/client/edits.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof editsModule>()),
  saveEdits: vi.fn<typeof saveEdits>(),
}));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let restoreLayout: (() => void) | undefined;
let mobile = true;
const loaded: LoadedEdits = { stored: { version: 1, cuts: [], revision: 0 }, etag: '"e.none"' };
const node = <T extends Element>(selector: string) => must(host.querySelector<T>(selector));
const stage = () => must(player);
const click = async (selector: string) => {
  await settle(() => {
    node<HTMLButtonElement>(selector).click();
  });
  // why: the settings sheet takes focus on its next frame (Base UI's focus manager), after the click settles.
  await settle(() => {
    vi.advanceTimersByTime(50);
  });
};

/** Registers the shared happy-dom editor environment for the enclosing describe. */
function useEditorHarness() {
  beforeEach(() => {
    mobile = true;
    player = undefined;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    restoreLayout = stubRulerLayout();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches:
        media.includes('prefers-reduced-motion') || (mobile && (media.includes('max-width: 720px') || media.includes('pointer: coarse'))),
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.mocked(saveEdits).mockRejectedValue(new Error('Offline'));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await settle(() => {
      root.unmount();
    });
    client.clear();
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    restoreLayout?.();
    vi.unstubAllGlobals();
  });
}

async function renderEditor(initial = loaded) {
  await settle(() => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Editor, { bundle: waterfallFixture(), loaded: initial })));
  });
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await settle(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function tool(selector: string) {
  await click('.editor-add-more');
  await settle(() => {
    must(document.querySelector<HTMLElement>(selector)).click();
  });
}

/** The settings sheet while open (a closing one stays mounted for its exit animation). */
const sheet = () => host.querySelector('[data-testid="phone-sheet"][data-open]');

describe('phone editor captions', () => {
  useEditorHarness();

  it('starts with the clip, one keyboard-operable playhead, the add tools and no settings sheet', async () => {
    await renderEditor();
    expect(node('.editor-mobile-heading h1').textContent).toBe('Test replay');
    expect(node('[data-testid="save-state"]').textContent).toBe('Not edited yet');
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(node<HTMLElement>('#editor-timeline').hidden).toBe(false);
    expect(node('[data-testid="phone-clip"]').getAttribute('aria-label')).toMatch(/^Recording, 0:00\.0 to /);
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(node('[aria-label="Playhead"]').closest('.phone-lanes-frame')).not.toBeNull();
    expect(node('[data-testid="add-caption"]').closest('.editor-add-toolbar')).not.toBeNull();
    expect(sheet()).toBeNull();
    expect(node('[data-testid="editor-export"]').closest('.editor-mobile-header')).not.toBeNull();
    expect(node('[data-testid="undo"]').closest('.editor-mobile-header')).not.toBeNull();
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    await settle(() => {
      node('[aria-label="Playhead"]').dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(false);
    const more = node<HTMLDetailsElement>('.editor-mobile-more');
    more.open = true;
    await settle(() => {
      more.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(more.open).toBe(false);
    expect(document.activeElement).toBe(more.querySelector('summary'));
  });

  it('adds one caption at the playhead with its text focused in the sheet, follows undo, and reopens it rather than adding another', async () => {
    await renderEditor();
    await settle(() => {
      stage().seek(3000);
    });
    await click('[data-testid="add-caption"]');
    expect(host.querySelectorAll('[data-testid="region-caption"]')).toHaveLength(1);
    expect(node<HTMLInputElement>('[data-testid="phone-sheet"] .editor-object-time input').value).toBe('3');
    const field = node<HTMLTextAreaElement>('[data-testid="caption-text"]');
    expect(document.activeElement).toBe(field);
    await input(field, 'Show the checkout');
    expect(node('[data-testid="region-caption"][aria-label*="Show the checkout"]')).not.toBeNull();
    await click('[data-testid="undo"]');
    expect(field.value).toBe('Caption');
    await click('[data-testid="mobile-object-done"]');
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(node('[data-testid="region-caption"]'));
    await click('[data-testid="phone-done"]');
    await click('[data-testid="add-caption"]');
    expect(host.querySelectorAll('[data-testid="region-caption"]')).toHaveLength(1);
    expect(document.activeElement).toBe(node('[data-testid="caption-text"]'));
  });

  it('generates step captions only through the explicit secondary command', async () => {
    await renderEditor();
    await tool('[data-testid="generate-step-captions"]');
    expect(host.querySelectorAll('[data-testid="region-caption"]')).toHaveLength(1);
    await click('[data-testid="phone-adjust"]');
    expect(node<HTMLInputElement>('.editor-object-time input').value).toBe('1.5');
    expect(node<HTMLTextAreaElement>('[data-testid="caption-text"]').value).toBe('Open projects');
  });
});

describe('phone editor objects', () => {
  useEditorHarness();

  it('selects a tapped object into the toolbar, opens its settings only on Adjust and returns focus to it', async () => {
    await renderEditor({
      etag: '"e.1"',
      stored: { ...loaded.stored, revision: 1, captions: [{ id: 'caption-existing', from: 2000, to: 4000, text: 'Existing caption' }] },
    });
    const caption = node<HTMLButtonElement>('[data-testid="region-caption"]');
    caption.focus();
    await settle(() => {
      caption.click();
    });
    expect(caption.getAttribute('aria-pressed')).toBe('true');
    expect(node('[data-testid="phone-object-toolbar"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="add-caption"]')).toBeNull();
    expect(sheet()).toBeNull();
    await click('[data-testid="phone-adjust"]');
    expect(node('[data-testid="phone-sheet"] h2').textContent).toBe('Caption');
    await click('[data-testid="mobile-object-done"]');
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(caption);
    await click('[data-testid="phone-done"]');
    expect(caption.getAttribute('aria-pressed')).toBe('false');
    expect(node('[data-testid="add-caption"]')).not.toBeNull();
  });

  it('opens the untouched clip without creating an edit and retimes it through the existing trim reducer', async () => {
    await renderEditor();
    await click('[data-testid="mobile-trim"]');
    expect(node('[data-testid="phone-sheet"] h2').textContent).toBe('Trim clip');
    expect(node('[data-testid="save-state"]').textContent).toBe('Not edited yet');
    await input(node<HTMLInputElement>('.editor-object-time input'), '1');
    expect(node('[data-testid="phone-clip"]').getAttribute('aria-label')).toMatch(/^Recording, 0:01\.0 to /);
    await click('[data-testid="mobile-remove-object"]');
    expect(node('[data-testid="phone-clip"]').getAttribute('aria-label')).toMatch(/^Recording, 0:00\.0 to /);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(node('[aria-label="Playhead"]'));
  });
});

describe('phone editor highlights and scrubbing', () => {
  useEditorHarness();

  it('preserves point/range highlights, undo/redo, their sheet and removal focus', async () => {
    await renderEditor();
    await tool('[data-testid="add-point-highlight"]');
    expect(host.querySelectorAll('[data-testid="timeline-highlight"]')).toHaveLength(1);
    expect(node('[data-testid="phone-sheet"] h2').textContent).toBe('Highlight');
    expect(node<HTMLButtonElement>('[data-testid="editor-export"]').disabled).toBe(true);
    await click('[data-testid="undo"]');
    expect(host.querySelectorAll('[data-testid="timeline-highlight"]')).toHaveLength(0);
    const more = node<HTMLDetailsElement>('.editor-mobile-more');
    more.open = true;
    await click('[data-testid="redo"]');
    expect(more.open).toBe(false);
    expect(document.activeElement).toBe(more.querySelector('summary'));
    expect(host.querySelectorAll('[data-testid="timeline-highlight"]')).toHaveLength(1);
    await tool('[data-testid="select-range"]');
    await click('[data-testid="phone-adjust"]');
    await click('[data-testid="phone-sheet"] [data-testid="add-period-highlight"]');
    expect(host.querySelectorAll('[data-testid="timeline-highlight"]')).toHaveLength(2);
    expect(node('[data-testid="phone-sheet"] h2').textContent).toBe('Highlight');
    await click('[data-testid="remove-highlight"]');
    expect(host.querySelectorAll('[data-testid="timeline-highlight"]')).toHaveLength(1);
    expect(document.activeElement).toBe(node('[aria-label="Playhead"]'));
  });

  it('scrubs while the lanes scroll and ends the scrub once they settle', async () => {
    await renderEditor();
    const lanes = node<HTMLElement>('[data-testid="timeline-lanes"]');
    await settle(() => {
      lanes.scrollLeft = 100;
      lanes.dispatchEvent(new Event('scroll'));
    });
    expect(stage().isScrubbing()).toBe(true);
    expect(stage().getTime()).toBeGreaterThan(0);
    const scrubbed = stage().getTime();
    await settle(() => {
      vi.advanceTimersByTime(400);
    });
    expect(stage().isScrubbing()).toBe(false);
    expect(stage().getTime()).toBe(scrubbed);
  });
});

describe('phone editor chrome', () => {
  useEditorHarness();

  it('keeps cursor settings transient and blocks leaving when a real edit fails to save', async () => {
    await renderEditor();
    await tool('[data-testid="add-point-highlight"]');
    await click('[data-testid="mobile-object-done"]');
    const more = node<HTMLDetailsElement>('.editor-mobile-more');
    more.open = true;
    const cursor = [...more.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Cursor options'));
    await settle(() => {
      must(cursor).click();
    });
    expect(node('[data-testid="phone-sheet"] h2').textContent).toBe('Cursor');
    expect(document.activeElement).toBe(node('[data-testid="phone-sheet"] h2'));
    await settle(() => {
      node('.editor-context-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(more.querySelector('summary'));
    more.open = true;
    await click('[data-testid="editor-done"]');
    expect(saveEdits).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(node('[data-testid="save-state"]').textContent).toContain('Not saved');
    expect(node('[data-testid="save-retry"]')).not.toBeNull();
  });

  it('opens a short coincident object picked by name without changing its timing, and returns focus to it', async () => {
    await renderEditor({
      etag: '"e.1"',
      stored: {
        ...loaded.stored,
        revision: 1,
        captions: [
          { id: 'tiny-a', from: 2000, to: 2100, text: 'First short caption' },
          { id: 'tiny-b', from: 2000, to: 2200, text: 'Second short caption' },
        ],
        highlights: [{ id: 'same-moment', kind: 'point', at: 2000, label: 'Same moment' }],
      },
    });
    const more = node<HTMLElement>('.editor-add-more');
    await click('.editor-add-more');
    const buttons = [...must(document.querySelector('[aria-label="On timeline"]')).querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(buttons).toHaveLength(3);
    const second = buttons.find((button) => button.textContent?.includes('Second short caption'));
    await settle(() => {
      must(second).click();
    });
    expect(more.isConnected).toBe(false);
    expect(document.querySelector('[aria-label="On timeline"]')).toBeNull();
    expect(stage().getTime()).toBe(2000);
    expect(node<HTMLTextAreaElement>('[data-testid="caption-text"]').value).toBe('Second short caption');
    expect(node<HTMLInputElement>('.editor-object-time input').value).toBe('2');
    await click('[data-testid="mobile-object-done"]');
    expect(document.activeElement).toBe(node('[data-region-id="tiny-b"]'));
  });

  it('keeps the desktop header, timeline and keyboard selection path', async () => {
    mobile = false;
    await renderEditor({
      etag: '"e.1"',
      stored: { ...loaded.stored, revision: 1, captions: [{ id: 'desktop-caption', from: 2000, to: 4000, text: 'Desktop caption' }] },
    });
    expect(host.querySelector('.editor-mobile-header')).toBeNull();
    expect(node('[data-testid="desktop-topbar"]')).not.toBeNull();
    expect(node<HTMLElement>('#editor-timeline').hidden).toBe(false);
    expect(host.querySelector('.editor-add-toolbar')).toBeNull();
    expect(host.querySelector('.phone-timeline')).toBeNull();
    await settle(() => {
      node<HTMLButtonElement>('[data-testid="region-caption"] .tl-region-body').focus();
    });
    expect(node('[data-testid="caption-text"]')).not.toBeNull();
  });
});
