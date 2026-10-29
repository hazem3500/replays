import { describe, expect, it } from 'vitest';
import { ViewerRegistry } from '../src/client/plugins/api.ts';
import type { EditorToolDefinition, ExportFormatDefinition } from '../src/client/plugins/api.ts';
import { runEditorTool } from '../src/client/plugins/editor-tools.ts';
import { EMPTY_EDITS } from '../src/shared/edits.ts';
import { editorReducer, initialEditorState } from '../src/client/editor/state.ts';
import { replay } from './fixtures.ts';

const tool = {
  id: 'caption',
  label: 'Caption',
  run: ({ edits }: Parameters<EditorToolDefinition['run']>[0]) => {
    edits.cuts.push({ id: 'cut', from: 100, to: 200 });
    return { ...edits, captions: [{ id: 'caption', from: 200, to: 800, text: 'Check this' }] };
  },
};

describe('host contributions', () => {
  it('applies an editor plugin through the core undo model without mutating history', () => {
    const registry = new ViewerRegistry();
    registry.apiFor('host').registerEditorTool(tool);
    const registered = registry.resolveSlot<null, EditorToolDefinition>('editor.tools', [], null)[0];
    expect(registered).toBeDefined();
    if (!registered) throw new Error('tool not registered');
    const initial = initialEditorState(EMPTY_EDITS);
    const result = runEditorTool(registered.render(null), {
      replay: replay(),
      edits: initial.present,
      duration: 1000,
      getTime: () => 0,
    });
    expect(initial.present.cuts).toEqual([]);
    if (!result) throw new Error('tool did not return edits');
    const changed = editorReducer(initial, { type: 'change', edits: result });
    expect(changed.present.captions?.[0]?.text).toBe('Check this');
    expect(editorReducer(changed, { type: 'undo' }).present).toEqual(initial.present);
  });

  it('rejects out-of-bounds edits before applying a tool result', () => {
    expect(() =>
      runEditorTool(
        { id: 'bad', label: 'Bad', run: () => ({ version: 1, cuts: [{ id: 'bad', from: 0, to: 2000 }] }) },
        { replay: replay(), edits: EMPTY_EDITS, duration: 1000, getTime: () => 0 },
      ),
    ).toThrow('after the end of the replay');
  });

  it('orders and hides export contributions with the shared slot policy', () => {
    const registry = new ViewerRegistry();
    const api = registry.apiFor('host');
    api.registerExportFormat({ id: 'json', label: 'JSON', run: () => ({ name: 'replay.json', data: '{}' }) });
    api.registerExportFormat({ id: 'text', label: 'Text', run: () => ({ name: 'replay.txt', data: 'recording' }) });
    api.configureSlot('export.formats', { hide: ['plugin:host:json'] });
    expect(
      registry.resolveSlot<null, ExportFormatDefinition>('export.formats', [], null).map((item) => item.render(null).label),
    ).toEqual(['Text']);
    registry.removePlugin('host');
    expect(registry.resolveSlot('export.formats', [], null)).toEqual([]);
  });

  it('rejects reserved, modifier and colliding shortcuts and releases unloaded keys', () => {
    const registry = new ViewerRegistry();
    const api = registry.apiFor('host');
    for (const key of ['k', 'Shift+E', 'Control+r'])
      expect(() => api.registerShortcut({ id: 'bad', label: 'Bad', keys: [key], run: () => {} })).toThrow(/reserved|letters/);
    api.registerShortcut({ id: 'good', label: 'Good', keys: ['g'], run: () => {} });
    expect(() => registry.apiFor('other').registerShortcut({ id: 'duplicate', label: 'Duplicate', keys: ['G'], run: () => {} })).toThrow(
      'conflict',
    );
    registry.removePlugin('host');
    expect(() =>
      registry.apiFor('other').registerShortcut({ id: 'released', label: 'Released', keys: ['g'], run: () => {} }),
    ).not.toThrow();
  });

  it('refuses sandboxed plugins the host editor and export contribution APIs', () => {
    const api = new ViewerRegistry().apiFor('user:draft');
    expect(() => api.registerEditorTool(tool)).toThrow('only host plugins');
    expect(() => api.registerExportFormat({ id: 'file', label: 'File', run: () => {} })).toThrow('only host plugins');
  });
});
