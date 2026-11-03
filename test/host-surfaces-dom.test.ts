// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostSurfaceContext, HostSurfaceDefinition } from '../src/client/plugins/api.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { HostSurfaceSlot } from '../src/client/plugins/HostSurface.tsx';
import { EditorHostSurface, EditorTopbarActions } from '../src/client/editor/EditorHostSurface.tsx';
import { PhoneLanes } from '../src/client/editor/PhoneLanes.tsx';
import { EditorInspector } from '../src/client/editor/EditorInspector.tsx';
import { VitalsBar } from '../src/client/viewer/performance/VitalsBar.tsx';
import { NetworkList } from '../src/client/viewer/network/NetworkList.tsx';
import { buildNetworkRows } from '../src/client/viewer/network/model.ts';
import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { settingsSections } from '../src/client/settings/sections.tsx';
import { EMPTY_EDITS, type ReplayEdits } from '../src/shared/edits.ts';
import { replay } from './fixtures.ts';
import { settle } from './settle.ts';

let root: Root;
let host: HTMLDivElement;
const noop = () => {};

function setUp() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  viewerRegistry.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

async function tearDown() {
  await settle(() => root.unmount());
  host.remove();
  viewerRegistry.reset();
  vi.unstubAllGlobals();
}

function register(slot: string, options: { id: string; text: (context: HostSurfaceContext) => string; cleanup?: () => void }) {
  viewerRegistry.apiFor('acme').registerSlotItem<HostSurfaceContext, HostSurfaceDefinition>(slot, {
    id: `plugin:acme:${options.id}`,
    order: 1000,
    render: () => ({
      label: options.id,
      render(container, context) {
        container.replaceChildren(document.createTextNode(options.text(context)));
        return options.cleanup;
      },
    }),
  });
}

async function render(node: ReactNode) {
  await settle(() => root.render(node));
}

describe('host diagnostic surfaces', () => {
  beforeEach(setUp);
  afterEach(tearDown);
  it('renders a custom network column beside the reordered core cells using its actual captured request', async () => {
    const bundle = replay();
    bundle.network.push({
      id: 'request-1',
      at: 0,
      duration: 10,
      method: 'GET',
      url: 'https://example.com/cart',
      status: 200,
      statusText: 'OK',
      requestHeaders: [],
      responseHeaders: [],
    });
    register('inspector.network.columns', { id: 'endpoint', text: (context) => context.request?.url ?? 'No request' });
    viewerRegistry.configureSlot('inspector.network.columns', { order: ['plugin:acme:endpoint', 'core:request'], hide: ['core:status'] });
    await render(
      createElement(
        PlayerContext,
        { value: new ReplayController(bundle) },
        createElement(NetworkList, {
          rows: buildNetworkRows(bundle),
          steps: bundle.steps,
          ceiling: 10,
          selected: undefined,
          onSelect: noop,
          empty: null,
        }),
      ),
    );
    expect([...host.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent)).toEqual([
      'endpoint',
      'Request',
      'Time',
      'Duration',
      'During',
    ]);
    expect(host.querySelector('[role="cell"][data-slot-item="plugin:acme:endpoint"]')?.textContent).toBe('https://example.com/cart');
    expect(host.querySelector('[data-custom-columns]')).not.toBeNull();
  });

  it('replaces a built-in vital through hide plus a namespaced contribution without hiding the other metrics', async () => {
    register('performance.vitals', { id: 'budget', text: () => 'Within the team budget' });
    viewerRegistry.configureSlot('performance.vitals', { hide: ['core:fcp'], order: ['plugin:acme:budget'] });
    await render(
      createElement(VitalsBar, {
        vitals: [
          { id: 'fcp', value: 100, at: 100 },
          { id: 'lcp', value: 200, at: 200 },
        ],
        peers: [],
        onPick: noop,
      }),
    );
    expect([...host.querySelectorAll<HTMLElement>('li[data-slot-item]')].map((item) => item.dataset.slotItem)).toEqual([
      'plugin:acme:budget',
      'core:lcp',
    ]);
    expect(host.textContent).toContain('Within the team budget');
    expect(host.textContent).toContain('Largest paint');
    expect(host.textContent).not.toContain('First paint');
  });
});

describe('host editor surfaces', () => {
  beforeEach(setUp);
  afterEach(tearDown);
  it('reorders and hides core topbar groups while mounting host actions', async () => {
    register('editor.topbar.actions', { id: 'publish', text: () => 'Publish for review' });
    viewerRegistry.configureSlot('editor.topbar.actions', { order: ['plugin:acme:publish'], hide: ['core:export'] });
    await render(createElement(EditorTopbarActions, { history: 'Undo and redo', exports: 'Export video' }));
    expect(host.textContent).toBe('Publish for reviewUndo and redo');
    expect(host.querySelector('[data-slot-item="core:export"]')).toBeNull();
  });

  it('renders custom inspector sections when replay-wide core settings are hidden', async () => {
    register('editor.inspector.sections', { id: 'review', text: () => 'Reviewer notes' });
    viewerRegistry.configureSlot('editor.inspector.sections', { hide: ['core:replay'] });
    await render(
      createElement(EditorInspector, {
        edits: EMPTY_EDITS,
        selection: undefined,
        duration: 1000,
        change: noop,
        commands: { onDone: noop, onDelete: noop, onCut: noop, onPeriodHighlight: noop, onSelectRange: noop },
        panels: { effectControls: null, highlightControls: null },
        replay: 'Cursor settings',
      }),
    );
    expect(host.textContent).toBe('Reviewer notes');
  });

  it('lets a phone timeline replace its clip with a host lane using the same time scale', async () => {
    register('editor.timeline.lanes', { id: 'notes', text: (context) => `Notes at ${context.scale?.x(500)} pixels` });
    viewerRegistry.configureSlot('editor.timeline.lanes', { hide: ['core:clip'] });
    await render(
      createElement(PhoneLanes, { duration: 1000, scale: 0.2, edits: EMPTY_EDITS, steps: [], selection: undefined, dispatch: noop }),
    );
    expect(host.textContent).toContain('Notes at 100 pixels');
    expect(host.querySelector('[data-slot-item="core:clip"]')).toBeNull();
  });
});

describe('host surface lifecycle and settings', () => {
  beforeEach(setUp);
  afterEach(tearDown);
  it('cleans up a mounted surface when its host plugin is unloaded', async () => {
    const cleanup = vi.fn<() => void>();
    register('editor.topbar.actions', { id: 'live', text: () => 'Live action', cleanup });
    await render(createElement(HostSurfaceSlot, { slot: 'editor.topbar.actions' }));
    expect(host.textContent).toBe('Live action');
    await settle(() => viewerRegistry.removePlugin('acme'));
    expect(host.textContent).toBe('');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('preserves the old editor state when a host tries to apply invalid edits', async () => {
    const change = vi.fn<(edits: ReplayEdits) => void>();
    let apply: HostSurfaceContext['changeEdits'];
    viewerRegistry.apiFor('acme').registerSlotItem<HostSurfaceContext, HostSurfaceDefinition>('editor.topbar.actions', {
      id: 'plugin:acme:invalid',
      order: 1000,
      render: (context) => {
        apply = (edits) => context.changeEdits?.(edits);
        return { label: 'Invalid edit', render: noop };
      },
    });
    const editorProps = {
      bundle: replay(),
      edits: EMPTY_EDITS,
      selection: undefined,
      duration: 1000,
      change,
      seek: noop,
      children: createElement(EditorTopbarActions, { history: null, exports: null }),
    };
    await render(createElement(EditorHostSurface, editorProps));
    expect(() => apply?.({ ...EMPTY_EDITS, trim: { start: 900, end: 100 } })).toThrow(/trim/i);
    expect(change).not.toHaveBeenCalled();
  });

  it('adds a named settings destination and applies the host section order and hiding', async () => {
    register('settings.sections', { id: 'privacy', text: (context) => (context.stacked ? 'Phone privacy' : 'Privacy controls') });
    viewerRegistry.configureSlot('settings.sections', { hide: ['core:cli'], order: ['plugin:acme:privacy'] });
    const sections = settingsSections({ stacked: true });
    expect(sections[0]?.section).toBe('plugin:acme:privacy');
    expect(sections.some((section) => section.section === 'cli')).toBe(false);
    const privacy = sections[0];
    if (!privacy) throw new Error('Expected the host settings destination');
    await render(privacy.render({ stacked: true }));
    expect(host.textContent).toBe('Phone privacy');
  });
});
