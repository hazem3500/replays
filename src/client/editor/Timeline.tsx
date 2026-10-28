import { FilmIcon, ScissorsIcon, XIcon } from 'lucide-react';
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Hint } from '@/components/icon-button.tsx';

import { type ReplayCut, type ReplayEdits } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { cssVars } from '../lib/css-vars.ts';
import { TimelineHighlights } from './TimelineHighlights.tsx';
import { type EditorAction, moveCut, type Selection, setTrimEdge, trimOf } from './state.ts';

/** Room left and right of the track, so the trim edges at 0 and at the end stay easy to grab. */
const PAD = 14;
/** Pointer travel before a press becomes a drag (below it, a press is a click: seek or select). */
const DRAG_PX = 3;
/** Arrow keys move an edge or a region by this much; Shift by NUDGE_LONG_MS. */
export const NUDGE_MS = 100;
export const NUDGE_LONG_MS = 1000;

/** The track's scale, shared by every lane: original ms ↔ px in the track column. */
export interface TimelineScale {
  duration: number;
  /** Usable px (the column minus PAD on both sides). */
  width: number;
  x(time: number): number;
  /** Original ms under a pointer's clientX. */
  timeAt(clientX: number): number;
}

const ScaleContext = createContext<TimelineScale | null>(null);
const MobileTimelineContext = createContext(false);
export function useTimelineScale() {
  const scale = useContext(ScaleContext);
  if (!scale) throw new Error('useTimelineScale outside <Timeline>');
  return scale;
}

/**
 * A pointer drag on the window (so it keeps going outside the element): `move` gets the time under the pointer and
 * whether this is the first move of the drag (a new undo step) ; `end` says whether it moved at all (a click if not).
 */
export function startDrag(
  event: ReactPointerEvent,
  scale: TimelineScale,
  handlers: { move?: (time: number, first: boolean) => void; end?: (moved: boolean, time: number) => void },
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  let moved = false;
  const onMove = (next: PointerEvent) => {
    if (!moved && Math.abs(next.clientX - startX) < DRAG_PX) return;
    const first = !moved;
    moved = true;
    handlers.move?.(scale.timeAt(next.clientX), first);
  };
  const onEnd = (next: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    document.documentElement.removeAttribute('data-timeline-dragging');
    handlers.end?.(moved, scale.timeAt(next.clientX));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  document.documentElement.setAttribute('data-timeline-dragging', '');
}

/** Arrow keys (Shift: longer), Home and End on a time control; `set` gets the new time. */
export function timeKeys(event: ReactKeyboardEvent, value: number, min: number, max: number, set: (time: number) => void) {
  const step = event.shiftKey ? NUDGE_LONG_MS : NUDGE_MS;
  let next: number | undefined;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
  else if (event.key === 'Home') next = min;
  else if (event.key === 'End') next = max;
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  set(Math.min(max, Math.max(min, next)));
}

/** Tick spacing: the smallest of these with at least ~72 px between labels. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** The trim stays selected on touch so its edges are always editable; elsewhere only an existing trim is. */
function trimSelection(mobile: boolean | undefined, trim: unknown): Selection {
  return mobile || trim ? { kind: 'trim' } : undefined;
}

function selectedHighlightId(selection: Selection) {
  return selection?.kind === 'highlight' ? selection.id : undefined;
}

function rulerTicks(width: number, duration: number) {
  const tick = TICK_STEPS.find((step) => width > 0 && (step / Math.max(1, duration)) * width >= 72) ?? TICK_STEPS.at(-1)!;
  const ticks: number[] = [];
  if (width > 0) for (let at = 0; at <= duration; at += tick) ticks.push(at);
  return { tick, ticks };
}

function tickLabel(ms: number, step: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  // Whole seconds read plainly ("0:01"); only the ticks between them carry a decimal ("0:01.5").
  const whole = step >= 1000 || ms % 1000 === 0;
  const text = whole ? String(Math.round(seconds)).padStart(2, '0') : seconds.toFixed(1).padStart(4, '0');
  return `${minutes}:${text}`;
}

/**
 * One region on a lane (a cut here; zoom, speed, blur and caption regions use it too): drag the body to move it, its
 * edges to resize, × (on hover or when selected) to remove it. A click selects it and shows where it starts. It is
 * a button for the keyboard: arrows move it (Shift: by a second), Delete or Backspace removes it.
 */
export function RegionBlock({
  id,
  kind,
  from,
  to,
  label,
  title,
  selected,
  onSelect,
  onEdit,
  onRemove,
  seekTo,
  children,
}: {
  id: string;
  kind: string;
  from: number;
  to: number;
  /** Short text inside the block when it fits ("4×", a caption). */
  label?: string;
  /** Accessible name and tooltip. */
  title: string;
  selected: boolean;
  onSelect: () => void;
  /** An edge or the whole block moved to `time` (for 'move': the new start); `first`: the first move of a drag. */
  onEdit: (edge: 'from' | 'to' | 'move', time: number, first: boolean) => void;
  onRemove: () => void;
  /** Where a click on it seeks (its start by default; a zoom seeks to where it is fully in). */
  seekTo?: number | undefined;
  children?: ReactNode;
}) {
  const scale = useTimelineScale();
  const mobile = useContext(MobileTimelineContext);
  const player = usePlayer();
  const left = scale.x(from);
  const naturalWidth = scale.x(to) - left;
  // Captions share a dense lane: preserve timing and a visible gap rather than growing over neighbours.
  const width = kind === 'caption' ? Math.max(1, naturalWidth - 2) : Math.max(6, naturalWidth);
  const showLabel = kind !== 'caption' || width >= 56;
  const length = to - from;
  const edge = (side: 'from' | 'to') => (event: ReactPointerEvent) => {
    onSelect();
    startDrag(event, scale, {
      move: (time, first) => {
        onEdit(side, time, first);
        player.seek(time);
      },
    });
  };
  return (
    <div
      className="tl-region"
      data-kind={kind}
      data-selected={selected || undefined}
      data-narrow={width < 44 || undefined}
      data-compact={width < 72 || undefined}
      data-region-id={id}
      data-testid={`region-${kind}`}
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      <button
        type="button"
        className="tl-region-body"
        aria-label={title}
        aria-pressed={selected}
        title={title}
        onPointerDown={(event) => {
          const offset = scale.timeAt(event.clientX) - from;
          startDrag(event, scale, {
            move: (time, first) => onEdit('move', time - offset, first),
            end: (moved) => {
              onSelect();
              if (mobile) player.pause();
              if (!moved) player.seek(seekTo ?? from);
            },
          });
        }}
        onFocus={() => {
          if (!mobile && !selected) onSelect();
        }}
        onClick={(event) => {
          if (!mobile || event.detail !== 0) return;
          onSelect();
          player.seek(seekTo ?? from);
          if (mobile) player.pause();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
            return;
          }
          timeKeys(event, from, 0, scale.duration - length, (time) => onEdit('move', time, true));
        }}
      >
        {label && showLabel ? <span className="tl-region-label">{label}</span> : null}
        {children}
      </button>
      <span className="tl-region-edge" data-edge="from" aria-hidden="true" onPointerDown={edge('from')} />
      <span className="tl-region-edge" data-edge="to" aria-hidden="true" onPointerDown={edge('to')} />
      <button
        type="button"
        className="tl-region-remove"
        aria-label={`Remove ${title}`}
        tabIndex={-1}
        data-testid={`remove-${kind}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * A lane: its glyph in the gutter (named by a tooltip) and its regions on the track. An empty lane says in place what
 * it is and how to add to it (`empty`), in the quietest text, so it explains itself without hover.
 */
/** The short name under each lane's icon; the full instruction stays in its tooltip. */
const LANE_LABELS: Record<string, string> = { clip: 'Clip', zoom: 'Zoom', speed: 'Speed', blur: 'Blur', caption: 'Captions' };

export function Lane({
  name,
  icon,
  kind,
  children,
  onTrackPointerDown,
  tall = false,
  empty,
  reveal = false,
}: {
  name: string;
  icon: ReactNode;
  kind: string;
  children: ReactNode;
  onTrackPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  tall?: boolean;
  empty?: string | undefined;
  /** Keyboard and menu-created effects reveal their track in the compact scrolling dock. */
  reveal?: boolean;
}) {
  const lane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) lane.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [reveal]);
  return (
    <div ref={lane} className="tl-lane" data-kind={kind} data-tall={tall || undefined} role="group" aria-label={name}>
      <Hint label={name} side="left">
        <span className="tl-gutter" aria-hidden="true">
          {icon}
          {LANE_LABELS[kind] ? <span className="tl-gutter-label">{LANE_LABELS[kind]}</span> : null}
        </span>
      </Hint>
      <div className="tl-track" data-testid={`lane-${kind}`} onPointerDown={onTrackPointerDown}>
        {empty ? (
          <span className="tl-lane-empty" aria-hidden="true">
            {empty}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/**
 * The editor's timeline: one wide strip holding every edit, on the original replay's scale. The ruler (ticks, the
 * the draggable playhead's head; press anywhere on it to seek and drag to scrub), then
 * lanes. The recording track stays plain; its accent edges are the trim, dragged directly;
 * cuts are hatched regions. Dragging on the clip selects a range (C cuts it), a click seeks. "Remove waits"
 * suggestions show as dashed regions until applied. `lanes` (the effects) go under it, on the same scale.
 */
export function Timeline({
  duration,
  mobile,
  edits,
  selection,
  dispatch,
  suggestions,
  onCutRange,
  lanes,
}: {
  duration: number;
  mobile?: boolean;
  edits: ReplayEdits;
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  suggestions: readonly ReplayCut[];
  /** Cut the selected range (the selection pill). */
  onCutRange: () => void;
  lanes?: ReactNode;
}) {
  const player = usePlayer();
  const touch = mobile === true;
  // The track column (the ruler): held in state, so the scale is rebuilt once it exists and when it resizes.
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  useEffect(() => {
    const element = column;
    if (!element) return;
    const measure = () => setColumnWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [column]);

  const scale = useMemo<TimelineScale>(() => {
    const width = Math.max(0, columnWidth - PAD * 2);
    return {
      duration,
      width,
      x: (time) => PAD + (duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0) * width,
      timeAt: (clientX) => {
        const rect = column?.getBoundingClientRect();
        if (!rect || width <= 0) return 0;
        return Math.round(Math.min(1, Math.max(0, (clientX - rect.left - PAD) / width)) * duration);
      },
    };
  }, [column, columnWidth, duration]);

  // The playhead follows the clock without re-rendering the timeline.
  useEffect(() => {
    const place = () => {
      if (playhead.current) playhead.current.style.transform = `translateX(${scale.x(player.getTime())}px)`;
    };
    place();
    return player.subscribeTime(place);
  }, [player, scale]);

  const latest = useRef(edits);
  useEffect(() => {
    latest.current = edits;
  }, [edits]);
  const change = (next: ReplayEdits, first: boolean, select?: Selection) =>
    dispatch({ type: 'change', edits: next, merge: !first, ...(select ? { select } : {}) });

  const scrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    player.beginScrub();
    player.seek(scale.timeAt(event.clientX));
    startDrag(event, scale, { move: (time) => player.seek(time), end: () => player.endScrub() });
  };

  const trim = trimOf(edits, duration);
  const range = selection?.kind === 'range' ? selection : undefined;
  const { tick, ticks } = rulerTicks(scale.width, duration);
  const trimEdge = (edge: 'start' | 'end') => (
    <span
      role="slider"
      tabIndex={0}
      className="tl-trim"
      data-edge={edge}
      data-testid={`trim-${edge}`}
      aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
      aria-keyshortcuts={edge === 'start' ? 'I' : 'O'}
      aria-valuemin={edge === 'start' ? 0 : trim.start}
      aria-valuemax={edge === 'start' ? trim.end : Math.round(duration)}
      aria-valuenow={trim[edge]}
      aria-valuetext={formatClock(trim[edge])}
      onPointerDown={(event) => {
        dispatch({ type: 'select', selection: trimSelection(mobile, edits.trim) });
        player.beginScrub();
        startDrag(event, scale, {
          move: (time, first) => {
            const next = setTrimEdge(latest.current, edge, time, duration);
            change(next, first, trimSelection(mobile, next.trim));
            player.seek(trimOf(next, duration)[edge]);
          },
          end: () => player.endScrub(),
        });
      }}
      onKeyDown={(event) =>
        timeKeys(event, trim[edge], edge === 'start' ? 0 : trim.start, edge === 'start' ? trim.end : duration, (time) => {
          const next = setTrimEdge(latest.current, edge, time, duration);
          change(next, true, trimSelection(mobile, next.trim));
          player.seek(trimOf(next, duration)[edge]);
        })
      }
    >
      <span className="tl-trim-grip" aria-hidden="true" />
    </span>
  );

  return (
    <MobileTimelineContext.Provider value={touch}>
      <ScaleContext.Provider value={scale}>
        <div className="timeline" data-testid="timeline" data-ready={scale.width > 0 || undefined}>
          <div className="tl-ruler-row">
            <span className="tl-gutter-spacer" aria-hidden="true" />
            <div ref={setColumn} className="tl-ruler" data-testid="timeline-ruler" onPointerDown={mobile ? undefined : scrub}>
              {mobile ? <MobileRulerSeek duration={duration} /> : null}
              {ticks.map((at) => (
                <span key={at} className="tl-tick" style={{ transform: `translateX(${scale.x(at)}px)` }}>
                  <span className="tl-tick-label">{tickLabel(at, tick)}</span>
                </span>
              ))}
            </div>
          </div>

          <Lane
            name="Clip: drag its edges to trim, drag across it to select a cut"
            kind="clip"
            tall
            icon={<FilmIcon />}
            onTrackPointerDown={(event) => {
              if (event.button !== 0) return;
              const start = scale.timeAt(event.clientX);
              startDrag(event, scale, {
                move: (time) => {
                  dispatch({ type: 'select', selection: { kind: 'range', from: Math.min(start, time), to: Math.max(start, time) } });
                  player.seek(time);
                },
                end: (moved, time) => {
                  if (moved) return;
                  dispatch({ type: 'select', selection: mobile ? { kind: 'trim' } : undefined });
                  player.seek(time);
                  if (mobile) player.pause();
                },
              });
            }}
          >
            {trim.start > 0 ? (
              <span className="tl-outside" style={{ left: 0, width: `${scale.x(trim.start)}px` }}>
                <span className="tl-outside-label">Trimmed</span>
              </span>
            ) : null}
            {trim.end < duration ? (
              <span className="tl-outside" style={{ left: `${scale.x(trim.end)}px`, right: 0 }}>
                <span className="tl-outside-label">Trimmed</span>
              </span>
            ) : null}
            <div
              className="tl-clip"
              data-selected={selection?.kind === 'trim' || undefined}
              style={{ left: `${scale.x(trim.start)}px`, width: `${Math.max(0, scale.x(trim.end) - scale.x(trim.start))}px` }}
            >
              {mobile ? (
                <button
                  type="button"
                  className="tl-clip-select"
                  aria-label="Select recording clip"
                  aria-pressed={selection?.kind === 'trim'}
                  onClick={(event) => {
                    if (event.detail === 0) {
                      dispatch({ type: 'select', selection: { kind: 'trim' } });
                      player.pause();
                    }
                  }}
                >
                  Recording
                </button>
              ) : null}
              {trimEdge('start')}
              {trimEdge('end')}
            </div>
            {suggestions.map((cut) => (
              <span
                key={cut.id}
                className="tl-suggestion"
                data-testid="wait-suggestion"
                title={cut.label ? `Wait: ${cut.label}` : 'Wait'}
                style={{ left: `${scale.x(cut.from)}px`, width: `${Math.max(4, scale.x(cut.to) - scale.x(cut.from))}px` }}
              />
            ))}
            {edits.cuts.map((cut) => (
              <RegionBlock
                key={cut.id}
                id={cut.id}
                kind="cut"
                from={cut.from}
                to={cut.to}
                title={`Cut ${formatClock(cut.from)} to ${formatClock(cut.to)}${cut.label ? `, ${cut.label}` : ''}`}
                selected={selection?.kind === 'cut' && selection.id === cut.id}
                onSelect={() => dispatch({ type: 'select', selection: { kind: 'cut', id: cut.id } })}
                onEdit={(edge, time, first) =>
                  change(moveCut(latest.current, cut.id, edge, time, duration), first, { kind: 'cut', id: cut.id })
                }
                onRemove={() => change({ ...latest.current, cuts: latest.current.cuts.filter((item) => item.id !== cut.id) }, true)}
              />
            ))}
            <TimelineHighlights
              highlights={edits.highlights}
              selectedId={selectedHighlightId(selection)}
              x={(time) => scale.x(time)}
              width={scale.width}
              pad={PAD}
              mobile={touch}
              dispatch={dispatch}
            />
            {range ? (
              <div
                className="tl-range"
                data-testid="range-selection"
                style={{ left: `${scale.x(range.from)}px`, width: `${Math.max(2, scale.x(range.to) - scale.x(range.from))}px` }}
              >
                <button
                  type="button"
                  className="tl-range-cut"
                  data-testid="cut-selection"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={onCutRange}
                >
                  <ScissorsIcon aria-hidden="true" />
                  Cut <kbd>C</kbd>
                </button>
              </div>
            ) : null}
          </Lane>

          {lanes}

          <div className="tl-playhead-layer" aria-hidden="true">
            <div ref={playhead} className="tl-playhead">
              <span className="tl-playhead-knob" onPointerDown={scrub} />
            </div>
          </div>
        </div>
      </ScaleContext.Provider>
    </MobileTimelineContext.Provider>
  );
}

/** The phone ruler is the one seek surface, sharing the timeline scale and playhead. */
function MobileRulerSeek({ duration }: { duration: number }) {
  const player = usePlayer();
  const time = usePlayhead();
  useEffect(() => () => player.endScrub(), [player]);
  return (
    <input
      className="editor-seek editor-ruler-seek"
      type="range"
      min={0}
      max={duration}
      step={100}
      value={time}
      style={cssVars({ '--editor-seek-progress': `${duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0}%` })}
      aria-label="Seek recording"
      aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        player.beginScrub();
      }}
      onPointerUp={() => player.endScrub()}
      onPointerCancel={() => player.endScrub()}
      onLostPointerCapture={() => player.endScrub()}
      onBlur={() => player.endScrub()}
      onChange={(event) => player.seek(event.currentTarget.valueAsNumber)}
    />
  );
}
