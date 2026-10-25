/** Capture pacing defaults, shared by the CLI and built-in drivers. */
export interface CapturePacingOptions {
  /** Hold after each non-wait action, 0–10000 ms. Default 0 preserves existing capture timing. */
  stepPauseMs?: number;
}

export const DEFAULT_STEP_PAUSE_MS = 0;
/** The built-in drivers type slowly enough to follow each character. */
export const TYPE_DELAY_MS = 80;

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
