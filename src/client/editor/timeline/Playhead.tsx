import type { PointerEvent as ReactPointerEvent } from 'react';

import { usePlayheadFollow } from '../../hooks/use-playhead-follow.ts';
import type { TimelineScale } from './scale.ts';

/** The playhead: one accent line through every lane, its knob on the ruler (drag it to scrub). */
export function Playhead({ scale, onScrub }: { scale: TimelineScale; onScrub: (event: ReactPointerEvent) => void }) {
  const line = usePlayheadFollow<HTMLDivElement>(scale);
  return (
    <div className="tl-playhead-layer" aria-hidden="true">
      <div ref={line} className="tl-playhead">
        <span className="tl-playhead-knob" onPointerDown={onScrub} />
      </div>
    </div>
  );
}
