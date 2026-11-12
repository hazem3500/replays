import { CrosshairIcon } from 'lucide-react';

import type { FocusMarker } from '../../shared/run-focus.ts';

/** What a screen reader hears for a marked row, after the row's own name. */
export function focusLabel(marker: FocusMarker) {
  return marker.note ? `Focus: ${marker.note}` : 'Focus';
}

/**
 * A row the suite run marked to look at: a crosshair in the accent colour, and the author's note beside it when there is
 * room (`compact` keeps only the crosshair; the note is then in the row's tooltip).
 */
export function FocusMark({ marker, compact = false }: { marker: FocusMarker; compact?: boolean }) {
  return (
    <span className="focus-mark" data-compact={compact || undefined} title={focusLabel(marker)}>
      <CrosshairIcon aria-hidden="true" />
      {compact || !marker.note ? (
        <span className="visually-hidden">{focusLabel(marker)}</span>
      ) : (
        <>
          <span className="visually-hidden">Focus: </span>
          <span className="focus-note">{marker.note}</span>
        </>
      )}
    </span>
  );
}
