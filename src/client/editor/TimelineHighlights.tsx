import type { ReplayHighlight } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { highlightEdge, highlightTargetOffsets } from '../highlights-layout.ts';
import { useHighlightTargetSize } from '../hooks/use-highlight-target-size.ts';
import { cssVars } from '../lib/css-vars.ts';
import { usePlayer } from '../player.ts';
import type { EditorAction } from './state.ts';

const NO_HIGHLIGHTS: readonly ReplayHighlight[] = [];

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

/** Playback navigation marks drawn over the clip lane: a point is one marker, a period is a band with two edge markers. */
export function TimelineHighlights({
  highlights,
  selectedId,
  x,
  width,
  pad,
  mobile,
  dispatch,
}: {
  highlights?: readonly ReplayHighlight[] | undefined;
  selectedId: string | undefined;
  x: (time: number) => number;
  width: number;
  pad: number;
  mobile: boolean;
  dispatch: (action: EditorAction) => void;
}) {
  const player = usePlayer();
  const list = highlights ?? NO_HIGHLIGHTS;
  const offsets = useMarkerOffsets(list, x, width, pad);
  return list.map((highlight) => {
    const selected = selectedId === highlight.id;
    const ats = markerAts(highlight);
    const start = ats[0] ?? 0;
    const end = ats.at(-1) ?? start;
    const title = highlightTitle(highlight);
    return (
      <span key={highlight.id} className="tl-highlight" data-kind={highlight.kind} data-selected={selected || undefined}>
        {highlight.kind === 'period' ? (
          <span
            className="tl-highlight-band"
            aria-hidden="true"
            style={{ left: `${x(start)}px`, width: `${Math.max(3, x(end) - x(start))}px` }}
          />
        ) : null}
        {ats.map((at, index) => {
          const edge = highlightEdge(highlight.kind, index);
          return (
            <button
              key={`${highlight.id}-${edge ?? 'point'}`}
              type="button"
              className="tl-highlight-marker"
              data-kind={highlight.kind}
              data-edge={edge}
              data-testid="timeline-highlight"
              data-highlight-id={highlight.id}
              aria-label={`${title} at ${formatClock(at)}`}
              aria-pressed={selected}
              title={`${title} · ${formatClock(at)}`}
              style={cssVars({ '--target-offset': `${offsets.get(highlight.id)?.[index] ?? 0}px` }, { left: `${x(at)}px` })}
              onFocus={() => {
                if (!mobile) dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                dispatch({ type: 'select', selection: { kind: 'highlight', id: highlight.id } });
                player.seek(at);
                if (mobile) player.pause();
              }}
            >
              <span className="tl-highlight-glyph" aria-hidden="true" />
              {selected && highlight.label && (highlight.kind === 'point' || index === 0) ? (
                <span className="tl-highlight-label">{highlight.label}</span>
              ) : null}
            </button>
          );
        })}
      </span>
    );
  });
}
