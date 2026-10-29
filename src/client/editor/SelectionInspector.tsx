import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { effectList, moveCut, moveEffect, setTrimEdge, trimOf, type Selection } from './state.ts';

function TimeField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (time: number) => void }) {
  return (
    <label className="editor-object-time">
      <span>
        {label}
        <span className="visually-hidden"> seconds</span>
      </span>
      <span className="editor-object-time-value">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={max / 1000}
          step="0.1"
          value={Number((value / 1000).toFixed(3))}
          onChange={(event) => {
            const seconds = event.currentTarget.valueAsNumber;
            if (Number.isFinite(seconds)) onChange(Math.round(seconds * 1000));
          }}
        />
        <span className="editor-object-time-unit" aria-hidden="true">
          s
        </span>
      </span>
    </label>
  );
}

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

export function selectionSpan(edits: ReplayEdits, selection: Selection, duration: number) {
  if (selection?.kind === 'trim') {
    const bounds = trimOf(edits, duration);
    return { from: bounds.start, to: bounds.end };
  }
  if (selection?.kind === 'range') return { from: selection.from, to: selection.to };
  const region = findRegion(edits, selection);
  return { from: region?.from, to: region?.to };
}

function removeLabel(kind: string | undefined, title: string) {
  if (kind === 'trim') return 'Reset trim';
  if (kind === 'cut') return 'Restore section';
  return `Remove ${title.toLowerCase()}`;
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

function ObjectActions({
  kind,
  title,
  from,
  to,
  commands,
}: {
  kind: string | undefined;
  title: string;
  from: number | undefined;
  to: number | undefined;
  commands: SelectionCommands;
}) {
  if (kind === 'range') {
    return (
      <div className="editor-object-actions">
        <Button variant="secondary" onClick={commands.onCut} data-testid="cut-selection">
          Cut selection
        </Button>
        <Button variant="ghost" onClick={commands.onPeriodHighlight} data-testid="add-period-highlight">
          Highlight range
        </Button>
      </div>
    );
  }
  if (kind === 'highlight') return null;
  return (
    <div className="editor-object-actions">
      <small>{from !== undefined && to !== undefined ? `${formatClock(to - from)} · drag edges on the timeline to adjust` : null}</small>
      <Button variant="ghost" onClick={commands.onDelete} data-testid="mobile-remove-object">
        {removeLabel(kind, title)}
      </Button>
    </div>
  );
}

type Retime = {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, selection?: Selection) => void;
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

/** A selection's properties: its own setting, start and end, and what can be done with it. */
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
    <>
      {kind === 'caption' ? (
        <label className="editor-caption-label" htmlFor="selection-caption-text">
          Caption text
        </label>
      ) : null}
      {kind === 'highlight' ? panels.highlightControls : panels.effectControls}
      {from !== undefined && to !== undefined ? (
        <div className="editor-object-timing" role="group" aria-label="Selected object timing">
          <TimeField label="Start" value={from} max={Math.max(0, to - 100)} onChange={(time) => retimeSelection(retime, 'from', time)} />
          <TimeField label="End" value={to} max={retime.duration} onChange={(time) => retimeSelection(retime, 'to', time)} />
        </div>
      ) : null}
      <ObjectActions kind={kind} title={title} from={from} to={to} commands={commands} />
    </>
  );
}
