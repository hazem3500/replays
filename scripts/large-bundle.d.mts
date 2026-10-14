import type { ReplayBundle } from '../src/shared/replay.ts';

export function generateLargeBundle(options?: {
  id?: string;
  events?: number;
  requests?: number;
  consoleEntries?: number;
  steps?: number;
  durationMs?: number;
  textLength?: number;
}): ReplayBundle;
