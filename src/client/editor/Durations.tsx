import { formatClock } from '../../shared/replay.ts';

/** "0:03.2 → 0:01.9": the recording's length and what the edits leave (just the length when nothing is removed). */
export function Durations({ original, edited }: { original: number; edited: number }) {
  const changed = Math.round(edited) !== Math.round(original);
  return (
    <span
      className="editor-durations"
      role="group"
      data-testid="durations"
      aria-label={changed ? `${formatClock(original)} recorded, ${formatClock(edited)} edited` : `${formatClock(original)} recorded`}
    >
      <span className="editor-durations-original" data-changed={changed || undefined}>
        {formatClock(original)}
      </span>
      {changed ? (
        <>
          <span aria-hidden="true">→</span>
          <strong data-testid="edited-length">{formatClock(edited)}</strong>
          <span className="editor-durations-note" aria-hidden="true">
            after edits
          </span>
        </>
      ) : null}
    </span>
  );
}
