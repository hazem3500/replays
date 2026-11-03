import type { ReactNode } from 'react';
import type { ReplayEdits } from '../../shared/edits.ts';
import { InspectorAction, InspectorFooter } from './InspectorParts.tsx';
import { type ChangeEdits, effectList, moveCut, moveEffect, setTrimEdge, trimOf, type Selection } from './state.ts';
import { TimingSection } from './TimingFields.tsx';

const OBJECT_TITLES: Record<string, string> = {
  trim: 'Trim clip',
  range: 'Selected range',
  caption: 'Caption',
  zoom: 'Zoom',
  speed: 'Speed',
  blur: 'Blur',
  highlight: 'Highlight',
};

export function objectTitle(kind: string | undefined, cursorOpen: boolean, placingBlur: boolean) {
  if (cursorOpen) return 'Cursor';
  if (placingBlur) return 'Place blur';
  return (kind ? OBJECT_TITLES[kind] : undefined) ?? 'Removed section';
}

function findRegion(edits: ReplayEdits, selection: Selection) {
  if (!selection || !('id' in selection)) return;
  const { kind } = selection;
  if (kind === 'highlight') return;
  if (kind === 'cut') return edits.cuts.find((item) => item.id === selection.id);
  return effectList(edits, kind).find((item) => item.id === selection.id);
}

/** Where the selection sits; a highlight answers for itself (a point has one time). */
export function selectionSpan(edits: ReplayEdits, selection: Selection, duration: number) {
  if (selection?.kind === 'trim') {
    const bounds = trimOf(edits, duration);
    return { from: bounds.start, to: bounds.end };
  }
  if (selection?.kind === 'range') return { from: selection.from, to: selection.to };
  if (selection?.kind === 'highlight') {
    const highlight = edits.highlights?.find((item) => item.id === selection.id);
    if (highlight?.kind === 'point') return { from: highlight.at, to: undefined };
    return { from: highlight?.from, to: highlight?.to };
  }
  const region = findRegion(edits, selection);
  return { from: region?.from, to: region?.to };
}

export type SelectionCommands = {
  onSelectRange: (from: number, to: number) => void;
  onDone: () => void;
  onDelete: () => void;
  onCut: () => void;
  onPeriodHighlight: () => void;
};

export type SelectionPanels = {
  effectControls: ReactNode;
  highlightControls: ReactNode;
  cursorInspector: ReactNode;
};

/**
 * The panel's closing action. Removing an effect or highlight is the one destructive thing, in red; resetting a trim
 * or restoring a cut section undoes an edit, so it stays neutral. A range is not an edit yet: cutting it is the point.
 */
function ObjectActions({ kind, title, commands }: { kind: string | undefined; title: string; commands: SelectionCommands }) {
  if (kind === 'range')
    return (
      <InspectorFooter>
        <InspectorAction tone="primary" icon="scissors" onClick={commands.onCut} data-testid="cut-selection">
          Cut selection
        </InspectorAction>
        <InspectorAction icon="map-pin" onClick={commands.onPeriodHighlight} data-testid="add-period-highlight">
          Highlight range
        </InspectorAction>
      </InspectorFooter>
    );
  if (kind === 'trim' || kind === 'cut')
    return (
      <InspectorFooter>
        <InspectorAction icon="rotate-ccw" onClick={commands.onDelete} data-testid="mobile-remove-object">
          {kind === 'trim' ? 'Reset trim' : 'Restore section'}
        </InspectorAction>
      </InspectorFooter>
    );
  return (
    <InspectorFooter>
      <InspectorAction
        tone="danger"
        icon="trash-2"
        onClick={commands.onDelete}
        data-testid={kind === 'highlight' ? 'remove-highlight' : 'mobile-remove-object'}
      >
        Remove {title.toLowerCase()}
      </InspectorAction>
    </InspectorFooter>
  );
}

type Retime = {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: ChangeEdits;
  commands: SelectionCommands;
};

function retimeSelection({ edits, selection, duration, change, commands }: Retime, edge: 'from' | 'to', time: number) {
  if (!selection) return;
  if (selection.kind === 'trim') change(setTrimEdge(edits, edge === 'from' ? 'start' : 'end', time, duration), selection);
  else if (selection.kind === 'range') {
    const next = Math.min(duration, Math.max(0, time));
    commands.onSelectRange(
      edge === 'from' ? Math.min(next, selection.to - 100) : selection.from,
      edge === 'to' ? Math.max(selection.from + 100, next) : selection.to,
    );
  } else if (selection.kind === 'cut') change(moveCut(edits, selection.id, edge, time, duration), selection);
  else if (selection.kind !== 'highlight') change(moveEffect(edits, selection.kind, selection.id, edge, time, duration), selection);
}

/** A selection's properties: its own setting, then its timing, then what can be done with it. */
export function SelectionBody({
  retime,
  title,
  from,
  to,
  panels,
  commands,
}: {
  retime: Retime;
  title: string;
  from: number | undefined;
  to: number | undefined;
  panels: SelectionPanels;
  commands: SelectionCommands;
}) {
  const kind = retime.selection?.kind;
  return (
    <div className="inspector-body">
      {kind === 'highlight' ? panels.highlightControls : panels.effectControls}
      {kind !== 'highlight' && from !== undefined && to !== undefined ? (
        <TimingSection
          span={to - from}
          hint="Or drag its edges on the timeline"
          fields={[
            { label: 'Start', value: from, max: Math.max(0, to - 100), onChange: (time) => retimeSelection(retime, 'from', time) },
            { label: 'End', value: to, max: retime.duration, onChange: (time) => retimeSelection(retime, 'to', time) },
          ]}
        />
      ) : null}
      <ObjectActions kind={kind} title={title} commands={commands} />
    </div>
  );
}
