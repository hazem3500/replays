import { ScissorsIcon } from 'lucide-react';

import type { TimelineScale } from './scale.ts';

/** A range dragged out on the clip, with its Cut pill (C does the same). */
export function RangeSelection({ from, to, scale, onCut }: { from: number; to: number; scale: TimelineScale; onCut: () => void }) {
  return (
    <div className="tl-range" data-testid="range-selection" style={{ left: `${scale.x(from)}px`, width: `${Math.max(2, scale.x(to) - scale.x(from))}px` }}>
      <button type="button" className="tl-range-cut" data-testid="cut-selection" onPointerDown={(event) => event.stopPropagation()} onClick={onCut}>
        <ScissorsIcon aria-hidden="true" />
        Cut <kbd>C</kbd>
      </button>
    </div>
  );
}
