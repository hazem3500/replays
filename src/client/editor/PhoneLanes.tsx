import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react';

import { HostSurfaceSlot } from '../plugins/HostSurface.tsx';

import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { laneRegions } from './lanes.tsx';
import { type EditorAction, type EffectKind, moveCut, moveEffect, type Selection, setTrimEdge, trimOf } from './state.ts';
import { startDrag, type TimelineScale } from './Timeline.tsx';

const KIND_NAMES: Record<EffectKind, string> = { zoom: 'Zoom', speed: 'Speed-up', blur: 'Blur', caption: 'Caption' };
/** A step segment or region narrower than this shows no label (a truncated word reads worse than none). */
const LABEL_PX = 44;

interface PhoneLanesProps {
  duration: number;
  /** Pixels per ms. */
  scale: number;
  edits: ReplayEdits;
  steps: readonly ReplayStep[];
  selection: Selection;
  dispatch: (action: EditorAction) => void;
}

function isSelected(selection: Selection, kind: string, id: string) {
  return selection?.kind === kind && 'id' in selection && selection.id === id;
}

/** An edge a finger or pointer drags (touch-action: none, so the lanes do not scroll under it). */
function Handle({ edge, at, onDrag }: { edge: 'from' | 'to'; at: number; onDrag: (event: ReactPointerEvent) => void }) {
  return <span className="phone-handle" data-edge={edge} style={{ left: `${at}px` }} onPointerDown={onDrag} aria-hidden="true" />;
}

/**
 * Drags an edge on the phone track: pointer x to original ms, one undo step per drag. Each move applies to the edits
 * as the drag found them; the step's earlier moves are replaced (merge), so nothing else changes them meanwhile.
 */
function edgeDrag(duration: number, scale: number, edits: ReplayEdits, dispatch: (action: EditorAction) => void) {
  return (event: ReactPointerEvent, apply: (current: ReplayEdits, time: number) => ReplayEdits) => {
    const track = event.currentTarget.closest('.phone-track');
    if (!(track instanceof HTMLElement)) return;
    const timeline: TimelineScale = {
      duration,
      width: duration * scale,
      x: (time) => time * scale,
      timeAt: (clientX) => Math.min(Math.max((clientX - track.getBoundingClientRect().left) / scale, 0), duration),
    };
    startDrag(event, timeline, {
      move: (time, first) => dispatch({ type: 'change', edits: apply(edits, time), merge: !first }),
    });
  };
}

type EdgeDrag = ReturnType<typeof edgeDrag>;

/**
 * The phone timeline's lanes on the original replay's scale: the clip (its step segments, trimmed ends, cuts and
 * highlights) and one slim strip per effect kind that has regions, each region labelled. Tapping selects; a selected
 * object's edges drag.
 */
export function PhoneLanes({ duration, scale, edits, steps, selection, dispatch }: PhoneLanesProps) {
  const stack = useRef<HTMLDivElement>(null);
  const drag = edgeDrag(duration, scale, edits, dispatch);
  const px = (time: number) => time * scale;
  const select = (next: Selection) => dispatch({ type: 'select', selection: next });
  return (
    <div ref={stack} className="phone-lane-stack">
      <HostSurfaceSlot
        slot="editor.timeline.lanes"
        context={{
          edits,
          duration,
          scale: {
            width: duration * scale,
            x: px,
            timeAt: (clientX) => Math.min(duration, Math.max(0, (clientX - (stack.current?.getBoundingClientRect().left ?? 0)) / scale)),
          },
        }}
        builtins={[
          {
            id: 'core:clip',
            order: 100,
            render: () => (
              <ClipLane duration={duration} scale={scale} edits={edits} steps={steps} selection={selection} select={select} drag={drag} />
            ),
          },
          ...laneRegions(edits).map((lane, index) => ({
            id: `core:${lane.kind}`,
            order: (index + 2) * 100,
            render: () => (
              <div key={lane.kind} className="phone-lane" data-kind={lane.kind}>
                {lane.regions.map((region) => {
                  const selected = isSelected(selection, lane.kind, region.id);
                  return (
                    <Region
                      key={region.id}
                      kind={lane.kind}
                      selected={selected}
                      left={px(region.from)}
                      width={px(region.to - region.from)}
                      region={region}
                      onSelect={() => select({ kind: lane.kind, id: region.id })}
                    >
                      {selected ? (
                        <SelectedEdges
                          from={0}
                          to={px(region.to - region.from)}
                          onDrag={(edge, event) =>
                            drag(event, (current, time) => moveEffect(current, lane.kind, region.id, edge, time, duration))
                          }
                        />
                      ) : null}
                    </Region>
                  );
                })}
              </div>
            ),
          })),
        ]}
      />
    </div>
  );
}

function SelectedEdges({
  from,
  to,
  onDrag,
}: {
  from: number;
  to: number;
  onDrag: (edge: 'from' | 'to', event: ReactPointerEvent) => void;
}) {
  return (
    <>
      <Handle edge="from" at={from} onDrag={(event) => onDrag('from', event)} />
      <Handle edge="to" at={to} onDrag={(event) => onDrag('to', event)} />
    </>
  );
}

function Region({
  kind,
  selected,
  left,
  width,
  region,
  onSelect,
  children,
}: {
  kind: EffectKind;
  selected: boolean;
  left: number;
  width: number;
  region: { id: string; from: number; to: number; label: string };
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <span
      className="phone-region-slot"
      style={{ left: `${left}px`, width: `${Math.max(4, width)}px` }}
      data-selected={selected || undefined}
    >
      <button
        type="button"
        className="phone-region"
        data-kind={kind}
        data-region-id={region.id}
        aria-pressed={selected}
        aria-label={`${KIND_NAMES[kind]}${region.label ? ` ${region.label}` : ''}, ${formatClock(region.from)} to ${formatClock(region.to)}`}
        onClick={onSelect}
        data-testid={`region-${kind}`}
      >
        {width >= LABEL_PX ? <span>{region.label}</span> : null}
      </button>
      {children}
    </span>
  );
}

interface ClipLaneProps extends Omit<PhoneLanesProps, 'dispatch'> {
  select: (next: Selection) => void;
  drag: EdgeDrag;
}

/**
 * The kept part of each step (from its start to the next step's), in ms from the trim start. Empty and trimmed-off
 * segments are left out, so the starts that remain are distinct.
 */
function stepSegments(steps: readonly ReplayStep[], trim: { start: number; end: number }) {
  return steps.flatMap((step, index) => {
    const from = Math.max(step.at, trim.start);
    const to = Math.min(steps[index + 1]?.at ?? trim.end, trim.end);
    return to > from ? [{ at: step.at, offset: from - trim.start, length: to - from, label: step.label }] : [];
  });
}

/** The recording: its step segments, trimmed-off ends, cuts and highlights; selected, its trim edges drag. */
function ClipLane({ duration, scale, edits, steps, selection, select, drag }: ClipLaneProps) {
  const px = (time: number) => time * scale;
  const trim = trimOf(edits, duration);
  const clipSelected = selection?.kind === 'trim';
  return (
    <div className="phone-lane" data-kind="clip">
      {trim.start > 0 ? <span className="phone-trimmed" style={{ left: 0, width: `${px(trim.start)}px` }} /> : null}
      {trim.end < duration ? <span className="phone-trimmed" style={{ left: `${px(trim.end)}px`, right: 0 }} /> : null}
      <button
        type="button"
        className="phone-clip"
        data-selected={clipSelected || undefined}
        aria-pressed={clipSelected}
        aria-label={`Recording, ${formatClock(trim.start)} to ${formatClock(trim.end)}`}
        style={{ left: `${px(trim.start)}px`, width: `${px(trim.end - trim.start)}px` }}
        onClick={() => select(clipSelected ? undefined : { kind: 'trim' })}
        data-testid="phone-clip"
      >
        {stepSegments(steps, trim).map((segment) => (
          <span key={segment.at} className="phone-step" style={{ left: `${px(segment.offset)}px`, width: `${px(segment.length)}px` }}>
            {px(segment.length) >= LABEL_PX ? segment.label : null}
          </span>
        ))}
      </button>
      <ClipMarks edits={edits} scale={scale} selection={selection} select={select} />
      {clipSelected ? (
        <SelectedEdges
          from={px(trim.start)}
          to={px(trim.end)}
          onDrag={(edge, event) => drag(event, (current, time) => setTrimEdge(current, edge === 'from' ? 'start' : 'end', time, duration))}
        />
      ) : null}
      {edits.cuts
        .filter((cut) => isSelected(selection, 'cut', cut.id))
        .map((cut) => (
          <SelectedEdges
            key={cut.id}
            from={px(cut.from)}
            to={px(cut.to)}
            onDrag={(edge, event) => drag(event, (current, time) => moveCut(current, cut.id, edge, time, duration))}
          />
        ))}
    </div>
  );
}

/** The cuts and highlights on the clip lane, each a button that selects it. */
function ClipMarks({ edits, scale, selection, select }: Pick<ClipLaneProps, 'edits' | 'scale' | 'selection' | 'select'>) {
  const px = (time: number) => time * scale;
  return (
    <>
      {edits.cuts.map((cut) => (
        <button
          key={cut.id}
          type="button"
          className="phone-cut"
          data-region-id={cut.id}
          data-selected={isSelected(selection, 'cut', cut.id) || undefined}
          aria-pressed={isSelected(selection, 'cut', cut.id)}
          aria-label={`Cut, ${formatClock(cut.from)} to ${formatClock(cut.to)}`}
          style={{ left: `${px(cut.from)}px`, width: `${Math.max(4, px(cut.to - cut.from))}px` }}
          onClick={() => select({ kind: 'cut', id: cut.id })}
          data-testid="region-cut"
        />
      ))}
      {(edits.highlights ?? []).map((highlight) => {
        const from = highlight.kind === 'point' ? highlight.at : highlight.from;
        return (
          <button
            key={highlight.id}
            type="button"
            className="phone-highlight"
            data-kind={highlight.kind}
            data-highlight-id={highlight.id}
            data-selected={isSelected(selection, 'highlight', highlight.id) || undefined}
            aria-pressed={isSelected(selection, 'highlight', highlight.id)}
            aria-label={`Highlight${highlight.label ? ` ${highlight.label}` : ''}, ${formatClock(from)}`}
            style={{ left: `${px(from)}px`, ...(highlight.kind === 'period' ? { width: `${px(highlight.to - highlight.from)}px` } : {}) }}
            onClick={() => select({ kind: 'highlight', id: highlight.id })}
            data-testid="timeline-highlight"
          />
        );
      })}
    </>
  );
}
