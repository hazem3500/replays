import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';

import type { ReplayEdits } from '../../shared/edits.ts';
import { type ReplayBlur, ZOOM_IN_MS } from '../../shared/effects.ts';
import { formatClock } from '../../shared/replay.ts';
import { useLatest } from '../hooks/use-latest.ts';
import { usePlayer } from '../player.ts';
import { addEffect, type EditorAction, type EffectKind, effectList, moveEffect, removeEffect, type Selection } from './state.ts';
import { Lane } from './timeline/Lane.tsx';
import { RegionBlock } from './timeline/RegionBlock.tsx';
import { startDrag, useTimelineScale } from './timeline/scale.ts';
import { editorStrings } from './strings.ts';
import { type EditorTool, editorTimelineLanes } from './tools.tsx';

/**
 * The effect lanes under the clip, on the timeline's scale, one per editing tool (`editor.timeline.lanes`). Dragging on an empty stretch
 * of a lane adds a region over it (one undo step); a click there seeks. Regions move, resize and go like cuts
 * (Timeline.tsx RegionBlock).
 */
export function EffectLanes({
  edits,
  selection,
  dispatch,
  showEmpty = false,
  added = [],
  onAddTrack,
}: {
  edits: ReplayEdits;
  selection: Selection;
  /** Every lane, empty or not (stories). */
  showEmpty?: boolean;
  /** Lanes shown empty because they were added from the "Add track" row. */
  added?: readonly EffectKind[];
  /** Shows the "Add track" row under the lanes (desktop). */
  onAddTrack?: (kind: EffectKind) => void;
  dispatch: (action: EditorAction) => void;
}) {
  const scale = useTimelineScale();
  const player = usePlayer();
  const latest = useLatest(edits);
  const change = (next: ReplayEdits, first: boolean, select?: Selection) =>
    dispatch({ type: 'change', edits: next, merge: !first, ...(select ? { select } : {}) });

  const shown = (kind: EffectKind) => showEmpty || effectList(edits, kind).length > 0 || selection?.kind === kind || added.includes(kind);
  const lanes = editorTimelineLanes();
  const missing = lanes.filter((tool) => !shown(tool.kind));

  return (
    <>
      {lanes
        .filter(({ kind }) => shown(kind))
        .map((tool) => {
          const { kind, lane } = tool;
          return (
            <Lane
              key={tool.id}
              name={lane.name}
              kind={kind}
              reveal={selection?.kind === kind || added.at(-1) === kind}
              icon={tool.render({})}
              empty={effectList(edits, kind).length ? undefined : lane.empty}
              onTrackPointerDown={(event) => {
                if (event.button !== 0) return;
                const base = latest.current;
                const start = scale.timeAt(event.clientX);
                startDrag(event, scale, {
                  move: (time, first) => {
                    const created = addEffect(base, kind, start, time, scale.duration);
                    if (created) change(created.edits, first, { kind, id: created.id });
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
                const text = (lane.label as (region: unknown) => string)(region);
                return (
                  <RegionBlock
                    key={region.id}
                    id={region.id}
                    kind={kind}
                    from={region.from}
                    to={region.to}
                    label={text}
                    title={`${lane.region} ${formatClock(region.from)} to ${formatClock(region.to)}${kind === 'caption' ? `: ${text}` : ''}`}
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
          );
        })}
      {onAddTrack && missing.length ? <AddTrackRow tools={missing} onAdd={onAddTrack} /> : null}
    </>
  );
}

/** Under the lanes: a quiet "+ Add track" listing the tools whose lane isn't showing. Lanes that show add by dragging. */
function AddTrackRow({ tools, onAdd }: { tools: readonly EditorTool[]; onAdd: (kind: EffectKind) => void }) {
  return (
    <div className="tl-lane tl-add-track" data-slot="editor.timeline.lanes">
      <span className="tl-gutter-spacer" aria-hidden="true" />
      <div className="tl-add-track-cell">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="tl-add-track-button" data-testid="add-track" />}>
            <PlusIcon aria-hidden="true" /> {editorStrings.dock.addTrack}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-auto min-w-44" aria-label={editorStrings.dock.addTrackMenu}>
            {tools.map((tool) => (
              <DropdownMenuItem key={tool.id} onClick={() => onAdd(tool.kind)} data-testid={`add-track-${tool.kind}`} data-slot-item={tool.id}>
                {tool.render({})} {tool.lane.track}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** The blur regions shown at a moment (original ms), for the preview's box editor. */
export function blursAtTime(blurs: readonly ReplayBlur[] | undefined, time: number) {
  return (blurs ?? []).filter((blur) => time >= blur.from && time < blur.to);
}
