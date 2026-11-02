import { FilmIcon } from 'lucide-react';

import type { ReplayCut, ReplayEdits } from '../../../shared/edits.ts';
import { formatClock } from '../../../shared/replay.ts';
import { useLatest } from '../../hooks/use-latest.ts';
import { useRangeDrag, useTrimEdge } from '../../hooks/use-timeline-drags.ts';
import { usePlayer } from '../../player.ts';
import { type EditorAction, moveCut, type Selection, trimOf } from '../state.ts';
import { Highlights } from './Highlights.tsx';
import { Lane } from './Lane.tsx';
import { RangeSelection } from './RangeSelection.tsx';
import { RegionBlock } from './RegionBlock.tsx';
import { timeKeys, type TimelineScale } from './scale.ts';

type Change = (edits: ReplayEdits, first: boolean, select?: Selection) => void;

/**
 * The clip lane: the recording (its accent edges are the trim, dragged directly), trimmed-off ends dimmed, cuts as
 * hatched regions, "Remove waits" suggestions dashed until applied, highlights, and a dragged-out range.
 */
export function ClipLane({
  scale,
  mobile,
  edits,
  selection,
  dispatch,
  suggestions,
  onCutRange,
}: {
  scale: TimelineScale;
  mobile: boolean;
  edits: ReplayEdits;
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  suggestions: readonly ReplayCut[];
  onCutRange: () => void;
}) {
  const player = usePlayer();
  const latest = useLatest(edits);
  const change: Change = (next, first, select) => dispatch({ type: 'change', edits: next, merge: !first, ...(select ? { select } : {}) });
  const rangeDrag = useRangeDrag(scale, dispatch, mobile);
  const { duration } = scale;
  const trim = trimOf(edits, duration);
  const range = selection?.kind === 'range' ? selection : undefined;
  return (
    <Lane name="Clip: drag its edges to trim, drag across it to select a cut" kind="clip" tall icon={<FilmIcon />} onTrackPointerDown={rangeDrag}>
      {trim.start > 0 ? <span className="tl-outside" style={{ left: 0, width: `${scale.x(trim.start)}px` }} /> : null}
      {trim.end < duration ? <span className="tl-outside" style={{ left: `${scale.x(trim.end)}px`, right: 0 }} /> : null}
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
        <TrimEdge edge="start" trim={trim} scale={scale} latest={latest} change={change} dispatch={dispatch} mobile={mobile} />
        <TrimEdge edge="end" trim={trim} scale={scale} latest={latest} change={change} dispatch={dispatch} mobile={mobile} />
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
          onEdit={(edge, time, first) => change(moveCut(latest.current, cut.id, edge, time, duration), first, { kind: 'cut', id: cut.id })}
          onRemove={() => change({ ...latest.current, cuts: latest.current.cuts.filter((item) => item.id !== cut.id) }, true)}
        />
      ))}
      <Highlights edits={edits} selection={selection} dispatch={dispatch} scale={scale} mobile={mobile} onRangeDrag={rangeDrag} />
      {range ? <RangeSelection from={range.from} to={range.to} scale={scale} onCut={onCutRange} /> : null}
    </Lane>
  );
}

/** A trim edge: a slider for the keyboard (arrows, Shift, Home/End; I and O set it at the playhead). */
function TrimEdge({
  edge,
  trim,
  scale,
  latest,
  change,
  dispatch,
  mobile,
}: {
  edge: 'start' | 'end';
  trim: { start: number; end: number };
  scale: TimelineScale;
  latest: { readonly current: ReplayEdits };
  change: Change;
  dispatch: (action: EditorAction) => void;
  mobile: boolean;
}) {
  const handle = useTrimEdge({ scale, edge, latest, change, dispatch, mobile });
  const start = edge === 'start';
  return (
    <span
      role="slider"
      tabIndex={0}
      className="tl-trim"
      data-edge={edge}
      data-testid={`trim-${edge}`}
      aria-label={start ? 'Trim start' : 'Trim end'}
      aria-keyshortcuts={start ? 'I' : 'O'}
      aria-valuemin={start ? 0 : trim.start}
      aria-valuemax={start ? trim.end : Math.round(scale.duration)}
      aria-valuenow={trim[edge]}
      aria-valuetext={formatClock(trim[edge])}
      onPointerDown={handle.onPointerDown}
      onKeyDown={(event) => timeKeys(event, trim[edge], start ? 0 : trim.start, start ? trim.end : scale.duration, handle.nudge)}
    >
      <span className="tl-trim-grip" aria-hidden="true" />
    </span>
  );
}
