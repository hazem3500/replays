import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorPluginTools } from '../src/client/plugins/EditorTools.tsx';
import { PluginContexts, createPluginContext } from '../src/client/plugins/PluginUi.tsx';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { usePluginExports } from '../src/client/hooks/use-plugin-exports.ts';
import { usePluginShortcuts } from '../src/client/hooks/use-plugin-shortcuts.ts';
import { ReplayController } from '../src/client/player.ts';
import { EMPTY_EDITS } from '../src/shared/edits.ts';
import { replay } from './fixtures.ts';

function Contributions() {
  const bundle = replay();
  const player = new ReplayController(bundle);
  usePluginShortcuts((owner) => createPluginContext(bundle, player, owner));
  const exports = usePluginExports();
  return createElement(
    'div',
    null,
    exports.map((item) => (item === 'core' ? 'Video' : item.label)).join(', '),
    createElement(
      EditorPluginTools,
      {
        context: { replay: bundle, edits: EMPTY_EDITS, duration: 1000, getTime: () => 0 },
        onApply: () => {
          throw new Error('SSR applied edits');
        },
      },
      'Core tools',
    ),
  );
}

describe('contribution server rendering', () => {
  afterEach(() => viewerRegistry.reset());

  it('server renders host contributions without invoking browser actions', () => {
    const api = viewerRegistry.apiFor('host');
    const invoked: string[] = [];
    api.registerEditorTool({
      id: 'caption',
      label: 'Add caption',
      run: () => {
        invoked.push('editor');
      },
    });
    api.registerExportFormat({
      id: 'json',
      label: 'Console JSON',
      run: () => {
        invoked.push('export');
      },
    });
    api.registerShortcut({
      id: 'greet',
      label: 'Greet',
      keys: ['g'],
      run: () => {
        invoked.push('shortcut');
      },
    });
    const bundle = replay();
    const player = new ReplayController(bundle);
    const html = renderToString(
      createElement(PluginContexts, { value: (owner) => createPluginContext(bundle, player, owner) }, createElement(Contributions)),
    );
    expect(html).toContain('Add caption');
    expect(html).toContain('Core tools');
    expect(html).toContain('Console JSON');
    expect(invoked).toEqual([]);
  });
});
