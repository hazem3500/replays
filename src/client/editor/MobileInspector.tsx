import { type ReactNode, useEffect, useRef } from 'react';
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
import { effectList, moveCut, moveEffect, setTrimEdge, trimOf, type Selection } from './state.ts';

/** Named access to short/coincident objects without distorting their timeline widths. */
export function mobileTimelineObjects(edits: ReplayEdits) {
  const objects: Array<{ key: string; label: string; at: number; selection: Selection }> = [];
  for (const kind of ['zoom', 'speed', 'blur', 'caption'] as const) {
    for (const item of effectList(edits, kind)) {
      const text = kind === 'caption' && 'text' in item ? item.text : '';
      objects.push({
        key: `${kind}:${item.id}`,
        label: text ? `Caption · ${text}` : kind === 'speed' ? 'Speed' : kind[0]!.toUpperCase() + kind.slice(1),
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

/** Adding an object is a command, never a permanent inspector destination. */
export function MobileAddToolbar({
  onTrim,
  onCaption,
  onBlur,
  onZoom,
  more,
  objects = [],
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

/** Only the selected timeline object's properties. No selection means no settings panel. */
export function MobileInspector({
  edits,
  selection,
  duration,
  change,
  onSelectRange,
  onDone,
  onDelete,
  onCut,
  onPeriodHighlight,
  effectControls,
  highlightControls,
  cursorInspector,
  cursorOpen,
  placingBlur,
}: {
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, selection?: Selection) => void;
  onSelectRange: (from: number, to: number) => void;
  onDone: () => void;
  onDelete: () => void;
  onCut: () => void;
  onPeriodHighlight: () => void;
  effectControls: ReactNode;
  highlightControls: ReactNode;
  cursorInspector: ReactNode;
  cursorOpen: boolean;
  placingBlur: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (cursorOpen || placingBlur) heading.current?.focus({ preventScroll: true });
  }, [cursorOpen, placingBlur]);
  if (!selection && !cursorOpen && !placingBlur) return null;
  const kind = selection?.kind;
  const region =
    selection && 'id' in selection && kind !== 'highlight'
      ? kind === 'cut'
        ? edits.cuts.find((item) => item.id === selection.id)
        : kind && kind !== 'range' && kind !== 'trim'
          ? effectList(edits, kind).find((item) => item.id === selection.id)
          : undefined
      : undefined;
  const bounds = kind === 'trim' ? trimOf(edits, duration) : undefined;
  const range = selection?.kind === 'range' ? selection : undefined;
  const from = bounds?.start ?? range?.from ?? region?.from;
  const to = bounds?.end ?? range?.to ?? region?.to;
  const title = cursorOpen
    ? 'Cursor'
    : placingBlur
      ? 'Place blur'
      : kind === 'trim'
        ? 'Trim clip'
        : kind === 'range'
          ? 'Selected range'
          : kind === 'caption'
            ? 'Caption'
            : kind === 'zoom'
              ? 'Zoom'
              : kind === 'speed'
                ? 'Speed'
                : kind === 'blur'
                  ? 'Blur'
                  : kind === 'highlight'
                    ? 'Highlight'
                    : 'Removed section';
  const retime = (edge: 'from' | 'to', time: number) => {
    if (!selection) return;
    if (selection.kind === 'trim') change(setTrimEdge(edits, edge === 'from' ? 'start' : 'end', time, duration), selection);
    else if (selection.kind === 'range') {
      const next = Math.min(duration, Math.max(0, time));
      onSelectRange(
        edge === 'from' ? Math.min(next, selection.to - 100) : selection.from,
        edge === 'to' ? Math.max(selection.from + 100, next) : selection.to,
      );
    } else if (selection.kind === 'cut') change(moveCut(edits, selection.id, edge, time, duration), selection);
    else if (selection.kind !== 'highlight') change(moveEffect(edits, selection.kind, selection.id, edge, time, duration), selection);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles from the property controls; the section is not a focus target.
    <section
      className="editor-context-panel"
      aria-label={`${title} properties`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <header>
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <Button variant="ghost" onClick={onDone} data-testid="mobile-object-done">
          Done
        </Button>
      </header>
      {cursorOpen ? (
        cursorInspector
      ) : placingBlur ? (
        <p>Drag over the area to hide on the preview. Done cancels placement.</p>
      ) : (
        <>
          {kind === 'caption' ? (
            <label className="editor-caption-label" htmlFor="mobile-caption-text">
              Caption text
            </label>
          ) : null}
          {kind !== 'highlight' ? effectControls : highlightControls}
          {from !== undefined && to !== undefined ? (
            <div className="editor-object-timing" role="group" aria-label="Selected object timing">
              <TimeField label="Start" value={from} max={Math.max(0, to - 100)} onChange={(time) => retime('from', time)} />
              <TimeField label="End" value={to} max={duration} onChange={(time) => retime('to', time)} />
            </div>
          ) : null}
          {kind === 'range' ? (
            <div className="editor-object-actions">
              <Button variant="secondary" onClick={onCut} data-testid="cut-selection">
                Cut selection
              </Button>
              <Button variant="ghost" onClick={onPeriodHighlight} data-testid="add-period-highlight">
                Highlight range
              </Button>
            </div>
          ) : kind !== 'highlight' ? (
            <div className="editor-object-actions">
              <small>
                {from !== undefined && to !== undefined ? `${formatClock(to - from)} · drag edges on the timeline to adjust` : null}
              </small>
              <Button variant="ghost" onClick={onDelete} data-testid="mobile-remove-object">
                {kind === 'trim' ? 'Reset trim' : kind === 'cut' ? 'Restore section' : `Remove ${title.toLowerCase()}`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
