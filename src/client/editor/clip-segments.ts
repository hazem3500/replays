import type { ReplayStep } from '../../shared/replay.ts';
import { type LabelRoom, wordsThatFit } from './block-label.ts';

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

/**
 * Where a clip segment's words may go, in ms from its start: past a cut over its start, and up to the next cut inside
 * it, so a label never runs under a cut and shows cut off.
 */
export function labelRoom(
  segment: Pick<StepSegment, 'offset' | 'length'>,
  trimStart: number,
  cuts: readonly { from: number; to: number }[],
) {
  const start = trimStart + segment.offset;
  const end = start + segment.length;
  let from = start;
  for (const cut of [...cuts].sort((a, b) => a.from - b.from)) if (cut.from <= from && cut.to > from) from = Math.min(cut.to, end);
  let to = end;
  for (const cut of cuts) if (cut.from > from) to = Math.min(to, cut.from);
  return { skip: from - start, length: Math.max(0, to - from) };
}

/** A segment's kept length: its own, less the cuts over it. */
export function keptLength(
  segment: Pick<StepSegment, 'offset' | 'length'>,
  trimStart: number,
  cuts: readonly { from: number; to: number }[],
) {
  const start = trimStart + segment.offset;
  const end = start + segment.length;
  const cut = cuts.reduce((sum, { from, to }) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0);
  return Math.max(0, segment.length - cut);
}

/** Room the hourglass before a wait's length takes: the 10 px glyph and the gap after it. */
const WAIT_GLYPH_PX = 13;

/**
 * What a clip segment shows in `width` px: a step's leading whole words (at least two, or its whole name, so a lone
 * first word never reads as something else), else `fallback` (its kind's name, "Fill") when that fits whole; a wait
 * the Waits tool's hourglass and its kept length ("1.5 s"), else nothing (never the hourglass alone, which reads as
 * an icon stub), so every wait reads the same on the desktop and the phone. Only what fits neither is left blank.
 */
export function segmentText(
  segment: StepSegment,
  kept: number,
  width: number,
  { fallback = '', ...room }: LabelRoom & { fallback?: string },
) {
  if (!segment.wait) {
    const words = wordsThatFit(segment.label, width, { minWords: 2, ...room });
    const kind = fallback && !words ? wordsThatFit(fallback, width, { ...room, lines: 1 }) : '';
    return { glyph: false, text: words || (kind === fallback ? kind : '') };
  }
  const text = wordsThatFit(`${waitSeconds(kept)}\u00a0s`, width - WAIT_GLYPH_PX, { ...room, lines: 1 });
  return { glyph: text !== '', text };
}
