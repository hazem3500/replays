import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import type { ReplayEdits } from '../../../shared/edits.ts';
import { formatClock } from '../../../shared/replay.ts';
import { highlightTargetOffsets } from '../../highlights-layout.ts';
import { usePlayer } from '../../player.ts';
import type { EditorAction, Selection } from '../state.ts';
import { PAD, type TimelineScale } from './scale.ts';

/** Each highlight marker's sideways offset, so close markers keep separate targets (28 px; 44 px on touch). */
function markerOffsets(edits: ReplayEdits, scale: TimelineScale) {
  const size = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 44 : 28;
  const markers =
    edits.highlights?.flatMap((highlight) =>
      (highlight.kind === 'point' ? [highlight.at] : [highlight.from, highlight.to]).map((at, index) => ({ id: highlight.id, index, position: scale.x(at) - PAD })),
    ) ?? [];
  const offsets = highlightTargetOffsets(
    markers.map((marker) => marker.position),
    scale.width,
    size,
  );
  const byId = new Map<string, number[]>();
  for (const [index, marker] of markers.entries()) {
    const list = byId.get(marker.id) ?? [];
    list[marker.index] = offsets[index] ?? 0;
    byId.set(marker.id, list);
  }
  return byId;
}

/** Highlight annotations on the clip: a point is one marker, a period a band with a marker at each end. */
export function Highlights({
  edits,
  selection,
  dispatch,
  scale,
  mobile,
  onRangeDrag,
}: {
  /** Phones: a drag that starts on a marker (a 44 px target) still selects a range on the clip. */
  onRangeDrag: (event: ReactPointerEvent, tap: () => void) => void;
  edits: ReplayEdits;
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  scale: TimelineScale;
  mobile: boolean;
}) {
  const player = usePlayer();
  const offsetsById = markerOffsets(edits, scale);
  return edits.highlights?.map((highlight) => {
    const selected = selection?.kind === 'highlight' && selection.id === highlight.id;
    const positions = highlight.kind === 'point' ? [highlight.at] : [highlight.from, highlight.to];
    const start = highlight.kind === 'point' ? highlight.at : highlight.from;
    const end = highlight.kind === 'point' ? highlight.at : highlight.to;
    const offsets = offsetsById.get(highlight.id) ?? [];
    const title = `${highlight.kind === 'point' ? 'Point highlight' : 'Period highlight'}${highlight.label ? `: ${highlight.label}` : ''}`;
    return (
      <span key={highlight.id} className="tl-highlight" data-kind={highlight.kind} data-selected={selected || undefined}>
        {highlight.kind === 'period' ? (
          <span
            className="tl-highlight-band"
            aria-hidden="true"
            style={{ left: `${scale.x(start)}px`, width: `${Math.max(3, scale.x(end) - scale.x(start))}px` }}
          />
        ) : null}
        {positions.map((at, index) => (
          <button
            key={`${highlight.id}-${index}`}
            type="button"
            className="tl-highlight-marker"
            data-kind={highlight.kind}
            data-edge={highlight.kind === 'period' ? (index === 0 ? 'from' : 'to') : undefined}
            data-testid="timeline-highlight"
            data-highlight-id={highlight.id}
            aria-label={`${title} at ${formatClock(at)}`}
            aria-pressed={selected}
            title={`${title} · ${formatClock(at)}`}
            style={{ left: `${scale.x(at)}px`, '--target-offset': `${offsets[index] ?? 0}px` } as CSSProperties}
            onFocus={() => {
              if (!mobile) dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
            }}
            onPointerDown={(event) => {
              // why: on touch the marker's wide target covers the clip; a tap still reaches onClick.
              if (mobile && event.pointerType === 'touch') onRangeDrag(event, () => undefined);
              else event.stopPropagation();
            }}
            onClick={() => {
              dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
              player.seek(at);
              if (mobile) player.pause();
            }}
          >
            <span className="tl-highlight-glyph" aria-hidden="true" />
            {selected && highlight.label && (highlight.kind === 'point' || index === 0) ? <span className="tl-highlight-label">{highlight.label}</span> : null}
          </button>
        ))}
      </span>
    );
  });
}
