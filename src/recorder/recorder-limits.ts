import type { RecorderOptions } from './types.ts';

export const DEFAULT_MAX_DURATION_MS = 3 * 60_000;
export const MAX_DURATION_CEILING_MS = 10 * 60_000;
export const MIN_DURATION_MS = 5_000;
export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
export const MAX_BYTES_CEILING = 20 * 1024 * 1024;
export const MAX_CONSOLE_ENTRIES = 500;
export const MAX_NETWORK_ENTRIES = 1_000;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** How long and how large one recording may get: the host's choice, kept within the ceilings. */
export function recorderLimits(options: Pick<RecorderOptions, 'maxDurationMs' | 'maxBytes'>): { maxDurationMs: number; maxBytes: number } {
  return {
    maxDurationMs: clamp(options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_CEILING_MS),
    maxBytes: clamp(options.maxBytes ?? DEFAULT_MAX_BYTES, 1024, MAX_BYTES_CEILING),
  };
}
