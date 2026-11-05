import type { ReplayStep } from '../../shared/replay.ts';

/** A pause's length in seconds, to a tenth. */
export const waitSeconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1);

/** A wait step the recorder named only as a wait ("Wait for the page"): the load after the step before it. */
const LOAD_WAIT = /^wait\b/i;

/** Whether `step` is a load wait: it joins the step before it on the clip and gets no dot of its own. */
export const isLoadWait = (step: Pick<ReplayStep, 'kind' | 'label'>) => step.kind === 'wait' && LOAD_WAIT.test(step.label.trim());

/** A length as a clip block names it, "Wait 1.5 s" or "Cut 2.0 s": the value and its unit joined by a no-break space. */
export const lengthLabel = (name: string, ms: number) => `${name} ${waitSeconds(ms)}\u00a0s`;

export interface StepSegment {
  at: number;
  /** ms from the trim start. */
  offset: number;
  length: number;
  label: string;
  /** The step's kind ("click", "fill"), whose name labels a segment too short for its words. */
  kind: string;
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
    const joins = last && last.offset + last.length >= from - trim.start && wait && (last.wait || isLoadWait(step));
    if (last && joins) {
      last.length = to - trim.start - last.offset;
      continue;
    }
    segments.push({ at: step.at, offset: from - trim.start, length: to - from, label: step.label, kind: step.kind, wait });
  }
  for (const segment of segments) if (segment.wait) segment.label = lengthLabel('Wait', segment.length);
  return segments;
}

/** The segment playing `offset` ms after the trim start: the last one starting by then, or the first before it. */
export function segmentAt<T extends Pick<StepSegment, 'offset'>>(segments: readonly T[], offset: number): T | undefined {
  let found = 0;
  for (const [index, segment] of segments.entries()) if (segment.offset <= offset) found = index;
  return segments[found];
}
