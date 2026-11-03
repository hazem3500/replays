import type { ReactNode } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { cn } from '@/lib/utils.ts';
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

/** What the panel's header action does for an object: removing is destructive; resetting a trim or restoring a cut is not. */
function objectAction(kind: string | undefined, title: string) {
  if (!kind || kind === 'range') return;
  if (kind === 'trim' || kind === 'cut')
    return {
      label: kind === 'trim' ? 'Reset trim' : 'Restore section',
      icon: 'rotate-ccw',
      tone: 'neutral',
      testId: 'mobile-remove-object',
    } as const;
  return {
    label: `Remove ${title.toLowerCase()}`,
    icon: 'trash-2',
    tone: 'danger',
    testId: kind === 'highlight' ? 'remove-highlight' : 'mobile-remove-object',
  } as const;
}

/**
 * The object's one undoable action, as an icon in the panel header beside its title: named for screen readers and in
 * its tooltip, reached by Tab after the back link, and the same as pressing Delete on the timeline.
 */
export function ObjectHeaderAction({ kind, title, onAction }: { kind: string | undefined; title: string; onAction: () => void }) {
  const action = objectAction(kind, title);
  if (!action) return null;
  return (
    <IconButton
      label={action.label}
      shortcut="Delete"
      tooltipSide="bottom"
      className={cn('inspector-header-action', action.tone === 'danger' && 'hover:bg-(--danger-soft) hover:text-(--danger)')}
      data-tone={action.tone}
      data-testid={action.testId}
      onClick={onAction}
    >
      <AnimatedIcon name={action.icon} size={16} />
    </IconButton>
  );
}

/** A dragged-out range is not an edit yet: cutting it is the point, so its actions stay in the panel. */
function RangeActions({ commands }: { commands: SelectionCommands }) {
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
  from,
  to,
  panels,
  commands,
}: {
  retime: Retime;
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
      {kind === 'range' ? <RangeActions commands={commands} /> : null}
    </div>
  );
}
