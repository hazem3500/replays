/** Capture pacing defaults, shared by the CLI and built-in drivers. */
export interface CapturePacingOptions {
  /** Hold after each non-wait action, 0–10000 ms. Default 0 preserves existing capture timing. */
  stepPauseMs?: number;
}

export const DEFAULT_STEP_PAUSE_MS = 0;
/** The built-in drivers type slowly enough to follow each character. */
export const TYPE_DELAY_MS = 80;
/** The longest hold or per-character delay a flag may ask for. */
const MAX_TYPE_DELAY_MS = 1_000;
const MAX_HOLD_MS = 10_000;

function milliseconds(flag: string, value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    throw new Error(`${flag} must be a number of milliseconds between 0 and ${max}`);
  return value;
}

/** `--type-delay`: per-character delay of a `type` step, 0 to 1000 ms; the default is `TYPE_DELAY_MS`. */
export const typeDelayMs = (value: unknown = TYPE_DELAY_MS): number => milliseconds('--type-delay', value, MAX_TYPE_DELAY_MS);

/** `--shot-delay`: the hold after a `shot` step, 0 to 10000 ms; undefined holds the step pause, as after any action. */
export const shotDelayMs = (value: unknown): number | undefined =>
  value === undefined ? undefined : milliseconds('--shot-delay', value, MAX_HOLD_MS);

/** A fixed wait longer than this, with no label, is pacing (`--compress-waits`); a shorter one is often the evidence that nothing happened. */
export const PACING_WAIT_LIMIT_MS = 5_000;
/** Replay time a compressed wait takes: long enough to see the page moving and read the "sped up" caption. */
export const PACING_WAIT_KEPT_MS = 2_000;

export function stepPauseMs(value: unknown = DEFAULT_STEP_PAUSE_MS): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new Error('stepPauseMs (--step-pause) must be a number of milliseconds between 0 and 10000');
  }
  return value;
}

export function assertCapturePacing(value: unknown): asserts value is CapturePacingOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('capture must be an object');
  const options = value as Record<string, unknown>;
  if (Object.keys(options).some((key) => key !== 'stepPauseMs')) throw new Error('capture contains unknown options');
  stepPauseMs(options.stepPauseMs);
}
