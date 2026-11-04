import type { ReplayStep } from '../../shared/replay.ts';

/** A pause's length in seconds, to a tenth. */
export const waitSeconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1);

/** A wait step the recorder named only as a wait ("Wait for the page"): the load after the step before it. */
const LOAD_WAIT = /^wait\b/i;

export interface StepSegment {
  at: number;
  /** ms from the trim start. */
  offset: number;
  length: number;
  label: string;
  /** A pause: drawn dim and named by its length. */
  wait: boolean;
}

/**
 * The clip's labelled segments on the desktop and the phone: the kept part of each step (from its start to the next
 * step's), in ms from the trim start. A wait named only as a wait is the load after the step before it, so it joins
 * that segment; waits back to back join into one, named by its length ("Wait 1.5 s"). Empty and trimmed-off
 * segments are left out, so the starts that remain are distinct.
 */
export function stepSegments(steps: readonly Pick<ReplayStep, 'at' | 'label' | 'kind'>[], trim: { start: number; end: number }) {
  const segments: StepSegment[] = [];
  for (const [index, step] of steps.entries()) {
    const from = Math.max(step.at, trim.start);
    const to = Math.min(steps[index + 1]?.at ?? trim.end, trim.end);
    if (to <= from) continue;
    const wait = step.kind === 'wait';
    const last = segments.at(-1);
    const joins = last && last.offset + last.length >= from - trim.start && wait && (last.wait || LOAD_WAIT.test(step.label.trim()));
    if (last && joins) {
      last.length = to - trim.start - last.offset;
      continue;
    }
    segments.push({ at: step.at, offset: from - trim.start, length: to - from, label: step.label, wait });
  }
  for (const segment of segments) if (segment.wait) segment.label = `Wait ${waitSeconds(segment.length)}\u00a0s`;
  return segments;
}
