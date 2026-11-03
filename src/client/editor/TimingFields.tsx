import { formatClock } from '../../shared/replay.ts';
import { InspectorSection } from './InspectorParts.tsx';

export interface TimingField {
  label: string;
  /** ms, original timeline. */
  value: number;
  max: number;
  onChange: (time: number) => void;
}

/** Seconds to one decimal, without a trailing ".0" ("2", "2.4"): what the field shows and the panel reads. */
const seconds = (ms: number) => String(Number((ms / 1000).toFixed(1)));

/**
 * One time as a single field: its name inside on the left, the seconds right-aligned before a quiet unit, the way a
 * native inspector lays out a measurement. The whole box takes focus styling, so it reads as one control.
 */
function TimeField({ label, value, max, onChange }: TimingField) {
  return (
    <label className="inspector-time">
      <span className="inspector-time-label" aria-hidden="true">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max / 1000}
        step="0.1"
        aria-label={`${label} in seconds`}
        value={Number((value / 1000).toFixed(3))}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.round(next * 1000));
        }}
      />
      <span className="inspector-time-unit" aria-hidden="true">
        s
      </span>
    </label>
  );
}

/**
 * Where the object sits in time: its fields side by side, its length as the section's value, and how else to change
 * it. One field (a point highlight) spans the row.
 */
export function TimingSection({ fields, span, hint }: { fields: readonly TimingField[]; span?: number | undefined; hint?: string }) {
  return (
    <InspectorSection label="Timing" value={span === undefined ? undefined : `${seconds(span)} s`} hint={hint}>
      <div className="inspector-time-row" role="group" aria-label="Timing" data-count={fields.length}>
        {fields.map((field) => (
          <TimeField key={field.label} {...field} />
        ))}
      </div>
    </InspectorSection>
  );
}

/** The header's quiet description of where an object sits: "0:00.4 to 0:02.4", or "At 0:02.0". */
export function spanText(from: number | undefined, to: number | undefined) {
  if (from === undefined) return undefined;
  if (to === undefined || to === from) return `At ${formatClock(from)}`;
  return `${formatClock(from)} to ${formatClock(to)}`;
}
