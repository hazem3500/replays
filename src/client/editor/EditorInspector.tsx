import type { ReactNode } from 'react';
import { ChevronLeftIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { InspectorSkeleton } from './InspectorSkeleton.tsx';
import { objectTitle, SelectionBody, selectionSpan, type SelectionCommands, type SelectionPanels } from './SelectionInspector.tsx';
import type { Selection } from './state.ts';

/**
 * The editor's one side panel. With a timeline selection it shows that object's properties; with none it shows the
 * replay-wide settings (`replay`), so the panel always describes what the person is working on.
 */
export function EditorInspector({
  loading = false,
  edits,
  selection,
  duration,
  change,
  commands,
  panels,
  replay,
}: {
  loading?: boolean;
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, selection?: Selection) => void;
  commands: SelectionCommands;
  panels: Omit<SelectionPanels, 'cursorInspector'>;
  replay: ReactNode;
}) {
  if (loading) return <InspectorSkeleton />;
  if (!selection) return replay;
  const { from, to } = selectionSpan(edits, selection, duration);
  const title = objectTitle(selection.kind, false, false);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape bubbles from the property controls and returns to the replay settings; the group is not a focus target.
    <div
      className="editor-inspector"
      role="group"
      aria-labelledby="inspector-heading"
      data-kind={selection.kind}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          commands.onDone();
        }
      }}
    >
      <header className="inspector-header">
        <Button variant="ghost" size="sm" className="inspector-back" onClick={commands.onDone} data-testid="inspector-back">
          <ChevronLeftIcon aria-hidden="true" />
          Replay
        </Button>
        <h2 id="inspector-heading">{title}</h2>
      </header>
      <SelectionBody
        retime={{ edits, selection, duration, change, commands }}
        title={title}
        from={from}
        to={to}
        panels={{ ...panels, cursorInspector: null }}
        commands={commands}
      />
    </div>
  );
}
