import { type ReactNode, useRef } from 'react';
import { CaptionsIcon, EllipsisIcon, EyeOffIcon, ScissorsIcon, ZoomInIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { useFocusWhen } from '../hooks/use-focus-when.ts';
import { effectList, moveCut, moveEffect, setTrimEdge, trimOf, type Selection } from './state.ts';

function effectLabel(kind: 'zoom' | 'speed' | 'blur' | 'caption', text: string) {
  if (text) return `Caption · ${text}`;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Named access to short/coincident objects without distorting their timeline widths. */
export function mobileTimelineObjects(edits: ReplayEdits) {
  const objects: Array<{ key: string; label: string; at: number; selection: Selection }> = [];
  for (const kind of ['zoom', 'speed', 'blur', 'caption'] as const) {
    for (const item of effectList(edits, kind)) {
      const text = kind === 'caption' && 'text' in item ? item.text : '';
      objects.push({
        key: `${kind}:${item.id}`,
        label: effectLabel(kind, text),
        at: item.from,
        selection: { kind, id: item.id },
      });
    }
  }
  for (const item of edits.cuts)
    objects.push({
      key: `cut:${item.id}`,
      label: item.label ? `Cut · ${item.label}` : 'Cut',
      at: item.from,
      selection: { kind: 'cut', id: item.id },
    });
  for (const item of edits.highlights ?? [])
    objects.push({
      key: `highlight:${item.id}`,
      label: item.label ? `Highlight · ${item.label}` : 'Highlight',
      at: item.kind === 'point' ? item.at : item.from,
      selection: { kind: 'highlight', id: item.id },
    });
  return objects.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

const NO_OBJECTS: ReturnType<typeof mobileTimelineObjects> = [];

/** Adding an object is a command, never a permanent inspector destination. */
export function MobileAddToolbar({
  onTrim,
  onCaption,
  onBlur,
  onZoom,
  more,
  objects = NO_OBJECTS,
  onSelectObject,
}: {
  onTrim: () => void;
  onCaption: () => void;
  onBlur: () => void;
  onZoom: () => void;
  more: Array<{ label: string; action: () => void; disabled?: boolean; testId?: string }>;
  objects?: ReturnType<typeof mobileTimelineObjects>;
  onSelectObject?: (object: ReturnType<typeof mobileTimelineObjects>[number]) => void;
}) {
  return (
    <div className="editor-add-toolbar" role="group" aria-label="Add or edit">
      <Button variant="ghost" onClick={onTrim} data-testid="mobile-trim">
        <ScissorsIcon aria-hidden="true" />
        Trim
      </Button>
      <Button variant="ghost" onClick={onCaption} data-testid="add-caption">
        <CaptionsIcon aria-hidden="true" />
        Caption
      </Button>
      <Button variant="ghost" onClick={onBlur} data-testid="add-blur">
        <EyeOffIcon aria-hidden="true" />
        Blur
      </Button>
      <Button variant="ghost" onClick={onZoom} data-testid="add-zoom">
        <ZoomInIcon aria-hidden="true" />
        Zoom
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="editor-add-more" aria-label="More editing tools" />}>
          <EllipsisIcon aria-hidden="true" />
          <span>More</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="w-[min(300px,calc(100vw-24px))] max-h-[min(440px,var(--available-height))]"
          aria-label="More editing tools"
        >
          {more.map((item) => (
            <DropdownMenuItem
              key={item.label}
              className="min-h-11"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={item.action}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          {objects.length > 0 ? (
            <DropdownMenuGroup aria-label="On timeline">
              <DropdownMenuSeparator />
              <DropdownMenuLabel>On timeline · {objects.length}</DropdownMenuLabel>
              {objects.map((object) => (
                <DropdownMenuItem key={object.key} className="editor-object-picker-item min-h-11" onClick={() => onSelectObject?.(object)}>
                  <span>{object.label}</span>
                  <time>{formatClock(object.at)}</time>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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

function objectTitle(kind: string | undefined, cursorOpen: boolean, placingBlur: boolean) {
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

function selectionSpan(edits: ReplayEdits, selection: Selection, duration: number) {
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

type MobileInspectorCommands = {
  onSelectRange: (from: number, to: number) => void;
  onDone: () => void;
  onDelete: () => void;
  onCut: () => void;
  onPeriodHighlight: () => void;
};

type MobileInspectorPanels = {
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
  commands: MobileInspectorCommands;
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
  commands: MobileInspectorCommands;
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

function InspectorBody({
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
  panels: MobileInspectorPanels;
  commands: MobileInspectorCommands;
}) {
  const kind = retime.selection?.kind;
  return (
    <>
      {kind === 'caption' ? (
        <label className="editor-caption-label" htmlFor="mobile-caption-text">
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

/** Only the selected timeline object's properties. No selection means no settings panel. */
export function MobileInspector({
  edits,
  selection,
  duration,
  change,
  commands,
  panels,
  cursorOpen,
  placingBlur,
}: {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, selection?: Selection) => void;
  commands: MobileInspectorCommands;
  panels: MobileInspectorPanels;
  cursorOpen: boolean;
  placingBlur: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusWhen(heading, cursorOpen || placingBlur);
  if (!selection && !cursorOpen && !placingBlur) return null;
  const { from, to } = selectionSpan(edits, selection, duration);
  const title = objectTitle(selection?.kind, cursorOpen, placingBlur);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: Escape bubbles from the property controls; the section is not a focus target.
    <section
      className="editor-context-panel"
      aria-label={`${title} properties`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          commands.onDone();
        }
      }}
    >
      <header>
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <Button variant="ghost" onClick={commands.onDone} data-testid="mobile-object-done">
          Done
        </Button>
      </header>
      {cursorOpen ? panels.cursorInspector : null}
      {placingBlur && !cursorOpen ? <p>Drag over the area to hide on the preview. Done cancels placement.</p> : null}
      {cursorOpen || placingBlur ? null : (
        <InspectorBody
          retime={{ edits, selection, duration, change, commands }}
          title={title}
          from={from}
          to={to}
          panels={panels}
          commands={commands}
        />
      )}
    </section>
  );
}
