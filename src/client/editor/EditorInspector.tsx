import type { ReactNode } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { InspectorSkeleton } from './InspectorSkeleton.tsx';
import { spanText } from './TimingFields.tsx';
import {
  ObjectHeaderAction,
  objectTitle,
  SelectionBody,
  selectionSpan,
  type SelectionCommands,
  type SelectionPanels,
} from './SelectionInspector.tsx';
import type { ChangeEdits, Selection } from './state.ts';
import { HostSurfaceSlot } from '../plugins/HostSurface.tsx';

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
  change: ChangeEdits;
  commands: SelectionCommands;
  panels: Omit<SelectionPanels, 'cursorInspector'>;
  replay: ReactNode;
}) {
  if (loading) return <InspectorSkeleton />;
  if (!selection)
    return (
      <HostSurfaceSlot
        slot="editor.inspector.sections"
        builtins={[{ id: 'core:replay', order: 100, render: () => <ReplayPanel>{replay}</ReplayPanel> }]}
      />
    );
  const { from, to } = selectionSpan(edits, selection, duration);
  const title = objectTitle(selection.kind, false, false);
  return (
    <HostSurfaceSlot
      slot="editor.inspector.sections"
      builtins={[
        {
          id: 'core:selection',
          order: 100,
          render: () => (
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
                  <AnimatedIcon name="chevron-left" size={14} />
                  Replay
                </Button>
                <div className="inspector-title-row">
                  <div className="inspector-title">
                    <h2 id="inspector-heading">{title}</h2>
                    <p className="inspector-subtitle">{spanText(from, to)}</p>
                  </div>
                  <ObjectHeaderAction kind={selection.kind} title={title} onAction={commands.onDelete} />
                </div>
              </header>
              <SelectionBody
                retime={{ edits, selection, duration, change, commands }}
                from={from}
                to={to}
                panels={{ ...panels, cursorInspector: null }}
                commands={commands}
              />
            </div>
          ),
        },
      ]}
    />
  );
}

/** With nothing selected: what the panel holds now (settings for the whole replay) and how to inspect an object. */
function ReplayPanel({ children }: { children: ReactNode }) {
  return (
    <div className="editor-inspector" data-kind="replay">
      <header className="inspector-header">
        <h2>Replay</h2>
        <p className="inspector-subtitle">Select a zoom, caption or other edit on the timeline to change it.</p>
      </header>
      {children}
    </div>
  );
}
