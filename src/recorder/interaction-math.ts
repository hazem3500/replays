/* why: mirrors the caps in src/shared/interaction-timing.ts because the recorder bundle may not import shared source;
   a parity test keeps the two in step. */
export const MAX_LONG_FRAMES = 300;
export const MAX_INTERACTIONS = 200;

/**
 * INP-style phases of one Event Timing entry. invariant: the three parts add up to `duration`; a browser that rounds
 * `processingEnd` past the end of the frame leaves presentation at 0 rather than negative.
 */
export function interactionBreakdown(entry: { startTime: number; duration: number; processingStart: number; processingEnd: number }) {
  const inputDelay = Math.max(0, entry.processingStart - entry.startTime);
  const processing = Math.max(0, entry.processingEnd - entry.processingStart);
  const presentation = Math.max(0, entry.startTime + entry.duration - entry.processingEnd);
  return { inputDelay, processing, presentation };
}
