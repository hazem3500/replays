import { Fragment, type ReactNode } from 'react';
import { PuzzleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { notify } from '../toast.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import type { EditorToolContext, EditorToolDefinition } from './contributions.ts';
import { usePluginSnapshot } from './PluginUi.tsx';
import { resolveSlot } from './registry.ts';
import { runEditorTool } from './editor-tools.ts';

export function EditorPluginTools({
  context,
  onApply,
  children,
}: {
  context: EditorToolContext;
  onApply: (edits: ReplayEdits) => void;
  children?: ReactNode;
}) {
  usePluginSnapshot();
  const items = resolveSlot<EditorToolContext, EditorToolDefinition | null>(
    'editor.tools',
    [{ id: 'core:tools', order: 100, render: () => null }],
    context,
  );
  return items.map((item) => {
    if (item.id === 'core:tools') return <Fragment key={item.id}>{children}</Fragment>;
    let tool: EditorToolDefinition | null;
    try {
      tool = item.render(context);
      if (!tool || (tool.when && !tool.when(context))) return null;
    } catch {
      return null;
    }
    return (
      <Button
        key={item.id}
        variant="ghost"
        size="sm"
        className="editor-tool pointer-coarse:min-h-11"
        onClick={() => {
          try {
            const edits = runEditorTool(tool, context);
            if (edits) onApply(edits);
          } catch {
            notify('The editor tool could not run');
          }
        }}
      >
        <PuzzleIcon aria-hidden="true" />
        {tool.label}
      </Button>
    );
  });
}
