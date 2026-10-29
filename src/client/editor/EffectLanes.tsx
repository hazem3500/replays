import { useEffect, useRef } from 'react';

import type { ReplayEdits } from '../../shared/edits.ts';
import { type ReplayBlur, ZOOM_IN_MS } from '../../shared/effects.ts';
import { formatClock } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import { addEffect, type EditorAction, type EffectKind, effectList, moveEffect, removeEffect, type Selection } from './state.ts';
import { LANES } from './lanes.tsx';
import { Lane, RegionBlock, startDrag, useTimelineScale } from './Timeline.tsx';

const KIND_NAMES: Record<EffectKind, string> = { zoom: 'Zoom', speed: 'Speed-up', blur: 'Blur', caption: 'Caption' };

/**
 * The effect lanes under the clip, on the timeline's scale: Zoom, Speed, Blur, Captions. Dragging on an empty stretch
 * of a lane adds a region over it (one undo step); a click there seeks. Regions move, resize and go like cuts
 * (Timeline.tsx RegionBlock).
 */
export function EffectLanes({
  edits,
  selection,
  dispatch,
  showEmpty = false,
}: {
  edits: ReplayEdits;
  selection: Selection;
  showEmpty?: boolean;
  dispatch: (action: EditorAction) => void;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const latest = useRef(edits);
  useEffect(() => {
    latest.current = edits;
  }, [edits]);
  const change = (next: ReplayEdits, first: boolean, select?: Selection) =>
    dispatch({ type: 'change', edits: next, merge: !first, ...(select ? { select } : {}) });

  return (
    <>
      {LANES.filter(({ kind }) => showEmpty || effectList(edits, kind).length > 0 || selection?.kind === kind).map(
        ({ kind, name, empty, icon, label }) => (
          <Lane
            key={kind}
            name={name}
            kind={kind}
            reveal={selection?.kind === kind}
            icon={icon}
            empty={effectList(edits, kind).length ? undefined : empty}
            onTrackPointerDown={(event) => {
              if (event.button !== 0) return;
              const base = latest.current;
              const start = scale.timeAt(event.clientX);
              startDrag(event, scale, {
                move: (time, first) => {
                  const added = addEffect(base, kind, start, time, scale.duration);
                  if (added) change(added.edits, first, { kind, id: added.id });
                },
                end: (moved, time) => {
                  if (moved) return;
                  dispatch({ type: 'select', selection: undefined });
                  player.seek(time);
                },
              });
            }}
          >
            {effectList(edits, kind).map((region) => {
              const text = (label as (region: unknown) => string)(region);
              return (
                <RegionBlock
                  key={region.id}
                  id={region.id}
                  kind={kind}
                  from={region.from}
                  to={region.to}
                  label={text}
                  title={`${KIND_NAMES[kind]} ${formatClock(region.from)} to ${formatClock(region.to)}${kind === 'caption' ? `: ${text}` : ''}`}
                  selected={selection?.kind === kind && selection.id === region.id}
                  seekTo={kind === 'zoom' ? region.from + Math.min(ZOOM_IN_MS, (region.to - region.from) / 2) : undefined}
                  onSelect={() => dispatch({ type: 'select', selection: { kind, id: region.id } })}
                  onEdit={(edge, time, first) =>
                    change(moveEffect(latest.current, kind, region.id, edge, time, scale.duration), first, { kind, id: region.id })
                  }
                  onRemove={() => change(removeEffect(latest.current, kind, region.id), true)}
                />
              );
            })}
          </Lane>
        ),
      )}
    </>
  );
}

/** The blur regions shown at a moment (original ms), for the preview's box editor. */
export function blursAtTime(blurs: readonly ReplayBlur[] | undefined, time: number) {
  return (blurs ?? []).filter((blur) => time >= blur.from && time < blur.to);
}
