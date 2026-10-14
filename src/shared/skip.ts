/**
 * "Skip inactive", shared by the viewer and the server render so previews and exports match what people see.
 *
 * rrweb's own skipInactive only fires on gaps longer than `inactivePeriodThreshold` (10 s by default) and then
 * plays them at gap ÷ 5 s speed, so every skip still takes about five seconds and our 9–15 s agent replays
 * (with 1–3 s idle waits) never skipped at all. We find idle gaps ourselves and fast-forward through them.
 */

/** A stretch without user interaction longer than this is inactive. */
export const INACTIVE_THRESHOLD_MS = 2000;
/** Real time kept at both ends of a gap, so the action before it settles and the next one is not jumped into. */
export const INACTIVE_LEAD_MS = 300;
/** Playback speed through an inactive gap: fast-forward that still reads as motion, not a cut. */
export const INACTIVE_SKIP_SPEED = 16;

export interface IdleGap {
  /** Replay time (ms from the first event) where fast-forward starts. */
  from: number;
  /** Where normal speed resumes. */
  to: number;
}

/** rrweb incremental sources that count as interaction: mouse move, mouse interaction, scroll, resize, input. */
const INTERACTION_SOURCES = new Set([1, 2, 3, 4, 5]);

/**
 * Idle gaps in an rrweb event list: between consecutive interactions (and from the last one to the end) where
 * nothing the user did happened for longer than INACTIVE_THRESHOLD_MS, trimmed by INACTIVE_LEAD_MS at both ends.
 */
export function idleGaps(
  events: ReadonlyArray<{ type: number; timestamp: number; data?: unknown }>,
  threshold = INACTIVE_THRESHOLD_MS,
): IdleGap[] {
  const start = events[0]?.timestamp;
  if (start === undefined) return [];
  const end = (events.at(-1)?.timestamp ?? start) - start;
  const marks = [0];
  for (const event of events) {
    const source = (event.data as { source?: number } | undefined)?.source;
    if (event.type === 3 && source !== undefined && INTERACTION_SOURCES.has(source)) marks.push(event.timestamp - start);
  }
  marks.push(end);
  const gaps: IdleGap[] = [];
  for (let index = 1; index < marks.length; index++) {
    const previous = marks[index - 1]!;
    const next = marks[index]!;
    if (next - previous <= threshold) continue;
    const from = previous + INACTIVE_LEAD_MS;
    const to = next - INACTIVE_LEAD_MS;
    if (to > from) gaps.push({ from, to });
  }
  return gaps;
}
