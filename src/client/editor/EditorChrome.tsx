import { Redo2Icon, Undo2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { IconButton } from '@/components/icon-button.tsx';

import type { ReplayEdits } from '../../shared/edits.ts';
import { IS_MAC, MOD } from './editor-tools.ts';
import { EditorInspector } from './EditorInspector.tsx';
import type { SelectionCommands } from './SelectionInspector.tsx';
import { EffectControls, HighlightControls } from './SelectionControls.tsx';
import { canRedo, canUndo, type EditorAction, type EditorState, type Selection } from './state.ts';

/** Desktop undo and redo, with their shortcuts in the tooltips. */
export function EditHistory({ state, dispatch }: { state: EditorState; dispatch: (action: EditorAction) => void }) {
  return (
    <div className="editor-history" role="group" aria-label="Edit history">
      <IconButton
        label="Undo"
        shortcut={`${MOD}Z`}
        tooltipSide="bottom"
        disabled={!canUndo(state)}
        onClick={() => dispatch({ type: 'undo' })}
        data-testid="undo"
      >
        <Undo2Icon aria-hidden="true" />
      </IconButton>
      <IconButton
        label="Redo"
        shortcut={IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'}
        tooltipSide="bottom"
        disabled={!canRedo(state)}
        onClick={() => dispatch({ type: 'redo' })}
        data-testid="redo"
      >
        <Redo2Icon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/** The phone header's undo; redo lives in More. */
export function PhoneUndo({ state, dispatch }: { state: EditorState; dispatch: (action: EditorAction) => void }) {
  return (
    <IconButton label="Undo" disabled={!canUndo(state)} onClick={() => dispatch({ type: 'undo' })} data-testid="undo">
      <Undo2Icon aria-hidden="true" />
    </IconButton>
  );
}

/** The desktop inspector column beside the stage, for the selection or, with nothing selected, the replay. */
export function InspectorAside({
  edits,
  selection,
  duration,
  change,
  commands,
  replay,
}: {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, selection?: Selection) => void;
  commands: SelectionCommands;
  replay: ReactNode;
}) {
  return (
    <aside className="editor-presentation" aria-label="Inspector">
      <EditorInspector
        edits={edits}
        selection={selection}
        duration={duration}
        change={change}
        commands={commands}
        panels={{
          effectControls: <EffectControls edits={edits} selection={selection} change={change} />,
          highlightControls: <HighlightControls edits={edits} selection={selection} duration={duration} change={change} />,
        }}
        replay={replay}
      />
    </aside>
  );
}

/** The desktop bar's "Remove waits" proposal, applied with Enter or the button. */
export function WaitSuggestion({ count, onApply, onDismiss }: { count: number; onApply: () => void; onDismiss: () => void }) {
  return (
    <span className="editor-suggest" role="status" data-testid="wait-suggestions">
      {count} {count === 1 ? 'wait' : 'waits'} found
      <Button size="sm" variant="secondary" onClick={onApply} data-testid="apply-waits">
        Remove all <kbd>↵</kbd>
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </span>
  );
}
