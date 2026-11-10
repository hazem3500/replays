import { renameSteps, stepNameKeys } from '../shared/edits.ts';
import { normalizeSteps } from '../shared/step-names.ts';
import type { ReplayStep } from '../shared/replay.ts';
import { must, usageError } from './errors.ts';
import { formatTime, parseTime } from './time.ts';

export interface StepRow {
  /** 1-based position in the recording, the number `rename` takes. */
  number: number;
  /** Original ms. */
  at: number;
  time: string;
  label: string;
  kind: string;
  /** The `stepNames` key this step's rename is stored under. */
  key: string;
  renamed: boolean;
  /** Part of the step before it (a click and the navigation it caused); the viewer does not list it. */
  folded: boolean;
}

/** The recording's steps as the viewer labels them, numbered from 1 in recorded order. */
export function stepRows(steps: readonly ReplayStep[], names?: Readonly<Record<string, string>>): StepRow[] {
  const keys = stepNameKeys(steps);
  const labelled = normalizeSteps(renameSteps(steps, names));
  return labelled.map((step, index) => {
    const key = keys[index] ?? String(step.at);
    return {
      number: index + 1,
      at: step.at,
      time: formatTime(step.at),
      label: step.label,
      kind: step.kind,
      key,
      renamed: names?.[key] !== undefined,
      folded: step.folded === true,
    };
  });
}

/** How close (ms) a time must be to a step's start to name it. */
export const STEP_TIME_TOLERANCE_MS = 150;

const describe = (row: StepRow) => `#${row.number} (${row.time}) ${row.label}`;

/**
 * The step a user means: `7` or `#7` is the 7th step; a time (`12.3s`, `1:02.5`, `1500ms`) is the step that starts there,
 * give or take STEP_TIME_TOLERANCE_MS. A time that names no step or several is an error that lists the candidates.
 */
export function resolveStep(rows: readonly StepRow[], ref: string): StepRow {
  if (rows.length === 0) throw usageError('this replay has no steps to target');
  const text = ref.trim();
  const index = /^#?(\d+)$/.exec(text);
  if (index) {
    const row = rows[Number(index[1]) - 1];
    if (!row) throw usageError(`there is no step ${text}; this replay has ${rows.length} (run \`replays edit <id> show\`)`);
    return row;
  }
  const at = parseTime(text);
  const near = rows.filter((row) => Math.abs(row.at - at) <= STEP_TIME_TOLERANCE_MS);
  if (near.length === 1) return must(near[0]);
  if (near.length > 1) throw usageError(`${near.length} steps start at ${text}; pick one by number: ${near.map(describe).join('; ')}`);
  const closest = rows.toSorted((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at)).slice(0, 3);
  throw usageError(`no step starts at ${text}; the closest are ${closest.map(describe).join('; ')}`);
}
