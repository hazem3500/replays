import type { PointerEvent as ReactPointerEvent } from 'react';

import { MIN_EDIT_MS, type ReplayHighlight } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { highlightEdge, highlightTargetOffsets } from '../highlights-layout.ts';
import { useHighlightTargetSize } from '../hooks/use-highlight-target-size.ts';
import { cssVars } from '../lib/css-vars.ts';
import { usePlayer } from '../player.ts';
import type { EditorAction } from './state.ts';
import { startDrag, timeKeys, useTimelineScale } from './timeline-drag.ts';

const NO_HIGHLIGHTS: readonly ReplayHighlight[] = [];

/** Which part of a highlight moves: a point's marker, one end of a period, or the whole period. */
export type HighlightEdge = 'at' | 'from' | 'to' | 'move';
/** `first`: the first move of a drag (a new undo step); later moves of the same drag merge into it. */
type OnMove = (id: string, edge: HighlightEdge, time: number, first: boolean) => void;

function markerAts(highlight: ReplayHighlight) {
  return highlight.kind === 'point' ? [highlight.at] : [highlight.from, highlight.to];
}

function highlightTitle(highlight: ReplayHighlight) {
  return `${highlight.kind === 'point' ? 'Point highlight' : 'Period highlight'}${highlight.label ? `: ${highlight.label}` : ''}`;
}

/** Hit-target offsets per highlight, so coincident or adjacent markers stay individually reachable. */
function useMarkerOffsets(highlights: readonly ReplayHighlight[], x: (time: number) => number, width: number, pad: number) {
  const targetSize = useHighlightTargetSize();
  const markers = highlights.flatMap((highlight) =>
    markerAts(highlight).map((at, index) => ({ id: highlight.id, index, position: x(at) - pad })),
  );
  const shifted = highlightTargetOffsets(
    markers.map((marker) => marker.position),
    width,
    targetSize,
  );
  const offsets = new Map<string, number[]>();
  for (const [index, marker] of markers.entries()) {
    const own = offsets.get(marker.id) ?? [];
    own[marker.index] = shifted[index] ?? 0;
    offsets.set(marker.id, own);
  }
  return offsets;
}

/** The keyboard range of one marker: a period's ends stay MIN_EDIT_MS apart. */
function markerBounds(highlight: ReplayHighlight, edge: HighlightEdge, duration: number) {
  if (highlight.kind === 'point') return { min: 0, max: duration };
  if (edge === 'from') return { min: 0, max: highlight.to - MIN_EDIT_MS };
  return { min: highlight.from + MIN_EDIT_MS, max: duration };
}

/**
 * One marker: a point highlight's diamond or one end of a period. Drag it to move that time (it seeks as it goes),
 * arrows nudge it (Shift by a second), and a click without movement selects the highlight and seeks to it.
 */
function HighlightMarker({
  highlight,
  index,
  offset,
  selected,
  dispatch,
  onMove,
}: {
  highlight: ReplayHighlight;
  index: number;
  offset: number;
  selected: boolean;
  dispatch: (action: EditorAction) => void;
  onMove: OnMove;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const at = markerAts(highlight)[index] ?? 0;
  const edge: HighlightEdge = highlightEdge(highlight.kind, index) ?? 'at';
  const title = highlightTitle(highlight);
  const select = () => dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
  const { min, max } = markerBounds(highlight, edge, scale.duration);
  return (
    <button
      type="button"
      className="tl-highlight-marker"
      data-kind={highlight.kind}
      data-edge={highlightEdge(highlight.kind, index)}
      data-testid="timeline-highlight"
      data-highlight-id={highlight.id}
      aria-label={`${title} at ${formatClock(at)}`}
      aria-pressed={selected}
      title={`${title} · ${formatClock(at)}`}
      style={cssVars({ '--target-offset': `${offset}px` }, { left: `${scale.x(at)}px` })}
      onFocus={select}
      onPointerDown={(event) =>
        startDrag(event, scale, {
          move: (time, first) => {
            onMove(highlight.id, edge, time, first);
            player.seek(time);
          },
        })
      }
      onClick={() => {
        select();
        player.seek(at);
      }}
      onKeyDown={(event) =>
        timeKeys(event, { value: at, min, max }, (time) => {
          onMove(highlight.id, edge, time, true);
          player.seek(time);
        })
      }
    >
      <span className="tl-highlight-glyph" aria-hidden="true" />
      {selected && highlight.label && (highlight.kind === 'point' || index === 0) ? (
        <span className="tl-highlight-label">{highlight.label}</span>
      ) : null}
    </button>
  );
}

/**
 * A period's band between its ends. Its top edge is a grip: drag it to move the whole period, or click it to select
 * the period and seek to its start. invariant: only the grip takes the pointer, so dragging across the middle of the
 * lane still selects a range to cut, highlighted or not.
 */
function HighlightBand({
  highlight,
  dispatch,
  onMove,
}: {
  highlight: ReplayHighlight & { kind: 'period' };
  dispatch: (action: EditorAction) => void;
  onMove: OnMove;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const left = scale.x(highlight.from);
  const onPointerDown = (event: ReactPointerEvent) => {
    const offset = scale.timeAt(event.clientX) - highlight.from;
    startDrag(event, scale, {
      move: (time, first) => {
        onMove(highlight.id, 'move', time - offset, first);
        player.seek(Math.max(0, time - offset));
      },
      end: (moved) => {
        dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
        if (!moved) player.seek(highlight.from);
      },
    });
  };
  return (
    <span
      className="tl-highlight-band"
      aria-hidden="true"
      style={{ left: `${left}px`, width: `${Math.max(3, scale.x(highlight.to) - left)}px` }}
    >
      <span className="tl-highlight-grip" data-testid="timeline-highlight-band" onPointerDown={onPointerDown} />
    </span>
  );
}

/**
 * Playback navigation marks drawn over the clip lane: a point is one marker, a period is a band with two edge
 * markers. They move like the other regions: drag a marker or the band, or nudge a focused marker with the arrows.
 */
export function TimelineHighlights({
  highlights,
  selectedId,
  x,
  width,
  pad,
  dispatch,
  onMove,
}: {
  highlights?: readonly ReplayHighlight[] | undefined;
  selectedId: string | undefined;
  x: (time: number) => number;
  width: number;
  pad: number;
  dispatch: (action: EditorAction) => void;
  onMove: OnMove;
}) {
  const list = highlights ?? NO_HIGHLIGHTS;
  const offsets = useMarkerOffsets(list, x, width, pad);
  return list.map((highlight) => {
    const selected = selectedId === highlight.id;
    return (
      <span key={highlight.id} className="tl-highlight" data-kind={highlight.kind} data-selected={selected || undefined}>
        {highlight.kind === 'period' ? <HighlightBand highlight={highlight} dispatch={dispatch} onMove={onMove} /> : null}
        {markerAts(highlight).map((_, index) => (
          <HighlightMarker
            key={`${highlight.id}-${highlightEdge(highlight.kind, index) ?? 'point'}`}
            highlight={highlight}
            index={index}
            offset={offsets.get(highlight.id)?.[index] ?? 0}
            selected={selected}
            dispatch={dispatch}
            onMove={onMove}
          />
        ))}
      </span>
    );
  });
}
