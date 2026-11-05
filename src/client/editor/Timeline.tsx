import { FilmIcon, ScissorsIcon } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

import { editTimeline } from '../../shared/edit-timeline.ts';
import { type ReplayCut, type ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { TimelineHighlights } from './TimelineHighlights.tsx';
import { TimelineStepDots } from './TimelineStepDots.tsx';
import { ClipStepLabel } from './BlockLabel.tsx';
import { stepKindName } from '../viewer/step-kinds.ts';
import { wordsThatFit } from './block-label.ts';
import { measureLabel } from './label-measure.ts';
import { clipRuns, keptLength, labelRoom, lengthLabel, segmentText, stepSegments } from './clip-segments.ts';
import { type EditorAction, moveCut, moveHighlight, type Selection, setTrimEdge, trimOf } from './state.ts';
import { rulerTicks, tickLabel } from './ruler.ts';
import { ScaleContext, startDrag, timeKeys, type TimelineScale } from './timeline-drag.ts';
import { Lane, RegionBlock } from './TimelineRegion.tsx';
import { HostSurfaceSlot, type SurfaceContent } from '../plugins/HostSurface.tsx';
import type { HostSurfaceContext } from '../plugins/surface-contracts.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';

/** Room left and right of the track, so the trim edges at 0 and at the end stay easy to grab. */
const PAD = 14;

/** Only an existing trim stays selected after its edge moves. */
function trimSelection(trim: unknown): Selection {
  return trim ? { kind: 'trim' } : undefined;
}

function selectedHighlightId(selection: Selection) {
  return selection?.kind === 'highlight' ? selection.id : undefined;
}

/** The clip's trimmed-away ends, dimmed and labelled outside the kept clip. */
function TrimmedOutside({ trim, duration, scale }: { trim: { start: number; end: number }; duration: number; scale: TimelineScale }) {
  return (
    <>
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
    </>
  );
}

/** why: the trim edges sit over the clip's ends, so the first and last step's words keep this much room on each side. */
const CLIP_STEP_PAD_PX = 12;
/** A step's inline padding inside the clip (editor.css .tl-clip-step). */
const CLIP_STEP_INNER_PAD_PX = 8;

/** The clip's steps: a faint divider where each starts and its leading whole words where they fit; waits dim, by their length. */
function ClipSteps({
  steps,
  trim,
  cuts,
  scale,
}: {
  steps: readonly ReplayStep[];
  trim: { start: number; end: number };
  cuts: readonly ReplayCut[];
  scale: TimelineScale;
}) {
  const px = scale.duration > 0 ? scale.width / scale.duration : 0;
  const segments = stepSegments(steps, trim);
  const labels = segments.map((segment, index) => {
    // why: only the side under a trim tab needs its wider pad, so an end step fits words as wide as the blocks below it.
    const edges = (index === 0 ? 1 : 0) + (index === segments.length - 1 ? 1 : 0);
    const roomPx = labelRoom(segment, trim.start, cuts).length * px - edges * (CLIP_STEP_PAD_PX - CLIP_STEP_INNER_PAD_PX);
    return segmentText(segment, keptLength(segment, trim.start, cuts), roomPx, {
      pad: CLIP_STEP_INNER_PAD_PX,
      measure: measureLabel,
      fallback: stepKindName(segment.kind),
    });
  });
  const runs = clipRuns(
    segments,
    labels.map((label) => !label.text),
  );
  return (
    <>
      {segments.map((segment, index) => {
        const room = labelRoom(segment, trim.start, cuts);
        const label = labels[index] ?? { glyph: false, text: '' };
        return (
          <span
            key={segment.at}
            className="tl-clip-step"
            data-testid="clip-step"
            data-wait={segment.wait || undefined}
            data-blank={!segment.wait && !label.text ? '' : undefined}
            aria-hidden="true"
            style={{ left: `${segment.offset * px}px`, width: `${segment.length * px}px` }}
          >
            <span className="tl-clip-step-label" style={{ marginLeft: `${room.skip * px}px` }}>
              <ClipStepLabel {...label} />
            </span>
          </span>
        );
      })}
      {runs.map((run) => (
        <span
          key={run.from}
          className="tl-clip-run"
          aria-hidden="true"
          style={{ left: `${run.from * px}px`, width: `${(run.to - run.from) * px}px` }}
        >
          {wordsThatFit(`${run.steps} steps`, (run.to - run.from) * px, { pad: CLIP_STEP_INNER_PAD_PX, measure: measureLabel })}
        </span>
      ))}
    </>
  );
}

/** The waits "Remove waits" would cut, shown before they are applied. */
function WaitSuggestions({ suggestions, scale }: { suggestions: readonly ReplayCut[]; scale: TimelineScale }) {
  return suggestions.map((cut) => (
    <span
      key={cut.id}
      className="tl-suggestion"
      data-testid="wait-suggestion"
      title={cut.label ? `Wait: ${cut.label}` : 'Wait'}
      style={{ left: `${scale.x(cut.from)}px`, width: `${Math.max(4, scale.x(cut.to) - scale.x(cut.from))}px` }}
    />
  ));
}

/**
 * The editor's timeline: one wide strip holding every edit, on the original replay's scale. The ruler (ticks, a dot
 * per recorded step, the draggable playhead's head; press anywhere on it to seek and drag to scrub), then
 * lanes. The recording track shows its steps quietly (a divider and their first words); its edges are the trim, dragged directly;
 * cuts are hatched regions. Dragging on the clip selects a range (C cuts it), a click seeks. "Remove waits"
 * suggestions show as dashed regions until applied. `lanes` (the effects) go under it, on the same scale.
 */
export function Timeline({
  steps,
  duration,
  edits,
  selection,
  dispatch,
  suggestions,
  onCutRange,
  lanes,
}: {
  /** The recording's steps: the ruler's dots. */
  steps: readonly ReplayStep[];
  duration: number;
  edits: ReplayEdits;
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  suggestions: readonly ReplayCut[];
  /** Cut the selected range (the selection pill). */
  onCutRange: () => void;
  lanes?: readonly SlotDescriptor<HostSurfaceContext, SurfaceContent>[];
}) {
  const player = usePlayer();
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
  const edited = editTimeline(edits, duration);
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
        dispatch({ type: 'select', selection: trimSelection(edits.trim) });
        player.beginScrub();
        startDrag(event, scale, {
          move: (time, first) => {
            const next = setTrimEdge(latest.current, edge, time, duration);
            change(next, first, trimSelection(next.trim));
            player.seek(trimOf(next, duration)[edge]);
          },
          end: () => player.endScrub(),
        });
      }}
      onKeyDown={(event) =>
        timeKeys(
          event,
          { value: trim[edge], min: edge === 'start' ? 0 : trim.start, max: edge === 'start' ? trim.end : duration },
          (time) => {
            const next = setTrimEdge(latest.current, edge, time, duration);
            change(next, true, trimSelection(next.trim));
            player.seek(trimOf(next, duration)[edge]);
          },
        )
      }
    >
      <span className="tl-trim-grip" aria-hidden="true" />
    </span>
  );

  return (
    <ScaleContext.Provider value={scale}>
      <div className="timeline" data-testid="timeline" data-ready={scale.width > 0 || undefined}>
        <div className="tl-ruler-row">
          <span className="tl-gutter-spacer" aria-hidden="true" />
          <div ref={setColumn} className="tl-ruler" data-testid="timeline-ruler" onPointerDown={scrub}>
            {ticks.map((at) => (
              <span key={at} className="tl-tick" style={{ transform: `translateX(${scale.x(at)}px)` }}>
                <span className="tl-tick-label">{tickLabel(at, tick)}</span>
              </span>
            ))}
            <TimelineStepDots steps={steps} isRemoved={(time) => edited.isRemoved(time)} />
          </div>
        </div>

        <HostSurfaceSlot
          slot="editor.timeline.lanes"
          context={{ edits, duration, scale, seek: player.seek }}
          builtins={[
            {
              id: 'core:clip',
              order: 100,
              render: () => (
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
                        dispatch({ type: 'select', selection: undefined });
                        player.seek(time);
                      },
                    });
                  }}
                >
                  <TrimmedOutside trim={trim} duration={duration} scale={scale} />
                  <div
                    className="tl-clip"
                    data-selected={selection?.kind === 'trim' || undefined}
                    style={{ left: `${scale.x(trim.start)}px`, width: `${Math.max(0, scale.x(trim.end) - scale.x(trim.start))}px` }}
                  >
                    <ClipSteps steps={steps} trim={trim} cuts={edits.cuts} scale={scale} />
                    {trimEdge('start')}
                    {trimEdge('end')}
                  </div>
                  <WaitSuggestions suggestions={suggestions} scale={scale} />
                  {edits.cuts.map((cut) => (
                    <RegionBlock
                      key={cut.id}
                      region={{
                        id: cut.id,
                        kind: 'cut',
                        from: cut.from,
                        to: cut.to,
                        title: `Cut ${formatClock(cut.from)} to ${formatClock(cut.to)}${cut.label ? `, ${cut.label}` : ''}`,
                        label: lengthLabel('Cut', cut.to - cut.from),
                      }}
                      selected={selection?.kind === 'cut' && selection.id === cut.id}
                      actions={{
                        onSelect: () => dispatch({ type: 'select', selection: { kind: 'cut', id: cut.id } }),
                        onEdit: (edge, time, first) =>
                          change(moveCut(latest.current, cut.id, edge, time, duration), first, { kind: 'cut', id: cut.id }),
                        onRemove: () => change({ ...latest.current, cuts: latest.current.cuts.filter((item) => item.id !== cut.id) }, true),
                      }}
                    />
                  ))}
                  <TimelineHighlights
                    highlights={edits.highlights}
                    selectedId={selectedHighlightId(selection)}
                    x={(time) => scale.x(time)}
                    width={scale.width}
                    pad={PAD}
                    dispatch={dispatch}
                    onMove={(id, edge, time, first) =>
                      change(moveHighlight(latest.current, { id, edge, time, duration }), first, { kind: 'highlight', id })
                    }
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
              ),
            },
            ...(lanes ?? []),
          ]}
        />

        <div className="tl-playhead-layer" aria-hidden="true">
          <div ref={playhead} className="tl-playhead">
            <span className="tl-playhead-knob" onPointerDown={scrub} />
          </div>
        </div>
      </div>
    </ScaleContext.Provider>
  );
}
