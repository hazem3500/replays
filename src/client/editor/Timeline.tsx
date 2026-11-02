import type { ReactNode } from 'react';

import type { ReplayCut, ReplayEdits } from '../../shared/edits.ts';
import { useScrub } from '../hooks/use-timeline-drags.ts';
import { useTimelineColumn } from '../hooks/use-timeline-column.ts';
import type { EditorAction, Selection } from './state.ts';
import { ClipLane } from './timeline/ClipLane.tsx';
import { Playhead } from './timeline/Playhead.tsx';
import { Ruler } from './timeline/Ruler.tsx';
import { MobileTimelineContext, ScaleContext } from './timeline/scale.ts';

export { Lane } from './timeline/Lane.tsx';
export { RegionBlock } from './timeline/RegionBlock.tsx';
export { NUDGE_LONG_MS, NUDGE_MS, startDrag, timeKeys, type TimelineScale, useTimelineScale } from './timeline/scale.ts';

/**
 * The editor's timeline: one wide strip holding every edit, on the original replay's scale. The ruler (ticks; press
 * anywhere on it to seek, drag to scrub), the clip lane (timeline/ClipLane.tsx), then `lanes` (the effects) on the
 * same scale, and the playhead through all of them.
 */
export function Timeline({
  duration,
  mobile = false,
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
  const { setColumn, scale } = useTimelineColumn(duration);
  const scrub = useScrub(scale);
  return (
    <MobileTimelineContext.Provider value={mobile}>
      <ScaleContext.Provider value={scale}>
        <div className="timeline" data-testid="timeline" data-ready={scale.width > 0 || undefined}>
          <Ruler scale={scale} mobile={mobile} columnRef={setColumn} onScrub={scrub} />
          <ClipLane
            scale={scale}
            mobile={mobile}
            edits={edits}
            selection={selection}
            dispatch={dispatch}
            suggestions={suggestions}
            onCutRange={onCutRange}
          />
          {lanes}
          <Playhead scale={scale} onScrub={scrub} />
        </div>
      </ScaleContext.Provider>
    </MobileTimelineContext.Provider>
  );
}
