/* why: mirrors the caps in src/shared/interaction-timing.ts because the recorder bundle may not import shared source;
   a parity test keeps the two in step. */
export const MAX_LONG_FRAMES = 300;
export const MAX_INTERACTIONS = 200;

/**
 * INP-style phases of one Event Timing entry. invariant: the three parts add up to `duration`; a browser that rounds
 * `processingStart` or `processingEnd` outside the interaction is clamped to its start and end.
 */
export function interactionBreakdown(entry: { startTime: number; duration: number; processingStart: number; processingEnd: number }) {
  const end = entry.startTime + entry.duration;
  const processingStart = Math.min(end, Math.max(entry.startTime, entry.processingStart));
  const processingEnd = Math.min(end, Math.max(processingStart, entry.processingEnd));
  return {
    inputDelay: processingStart - entry.startTime,
    processing: processingEnd - processingStart,
    presentation: end - processingEnd,
  };
}
