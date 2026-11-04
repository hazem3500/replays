import type { ReplayStep } from '../../shared/replay.ts';
import { wordsThatFit, type LabelRoom } from './block-label.ts';
import { type StepSegment, stepSegments, waitSeconds } from './clip-segments.ts';

/** One dot on the ruler: the step it seeks to and how many neighbours too close to tell apart it stands for. */
export interface StepDot {
  /** Index of its first step in the recording's list. */
  index: number;
  at: number;
  label: string;
  kind: string;
  count: number;
  /** How many of them are actions rather than waits. */
  actions: number;
  /** Where a click seeks: the step's start (a wait dot sits mid-block, but seeks to where its wait begins). */
  seek: number;
  /** A wait's own span, when its block gave one. */
  span?: { from: number; to: number } | undefined;
  /** How long the waits merged into an action dot last, so its tooltip still names them. */
  pause?: number | undefined;
  /** How long the wait merged into an action dot from before it lasts: the dot moves to the action, which follows it. */
  waitBefore?: number | undefined;
  /** When the next dot's step starts, or the recording ends: where a wait dot's pause stops. */
  until: number;
  /** The action a wait dot follows, when there is one before it. */
  after?: string | undefined;
}

/** Dots closer than this many px merge, so every dot keeps a 24 px target that no other overlaps. */
export const MIN_DOT_GAP_PX = 24;

/** What the ruler marks: an action step, or a wait drawn at the middle of its clip block, with the span it covers. */
export interface DotMark {
  at: number;
  label: string;
  kind: string;
  span?: { from: number; to: number } | undefined;
}

/**
 * The ruler's marks from the same blocks the clip draws: each action at its start, and each wait block (load waits
 * folded into their step, waits back to back joined) once, at its middle, so a hollow dot always sits over a wait
 * block and clears the action dot where the wait begins.
 */
export function stepMarks(steps: readonly ReplayStep[], duration: number): DotMark[] {
  const waits = stepSegments(steps, { start: 0, end: duration })
    .filter((segment) => segment.wait)
    .map((segment) => ({
      at: segment.at + segment.length / 2,
      kind: 'wait',
      label: steps.find((step) => step.at === segment.at && step.kind === 'wait')?.label ?? '',
      span: { from: segment.at, to: segment.at + segment.length },
    }));
  return [...steps.filter((step) => step.kind !== 'wait'), ...waits];
}

/**
 * The recording's steps as ruler dots, in time order, for a ruler `width` px wide over `duration`. Steps closer than
 * `gap` px join the dot before them, which seeks to the first, is named by the first action among them (a wait only
 * when all are waits) and counts the rest. Steps outside the recording are left out.
 */
export function placeStepDots(steps: readonly DotMark[], duration: number, width: number, gap = MIN_DOT_GAP_PX): StepDot[] {
  if (duration <= 0 || width <= 0) return [];
  const order = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.at >= 0 && step.at <= duration)
    .sort((a, b) => a.step.at - b.step.at || a.index - b.index);
  const dots: StepDot[] = [];
  let action: string | undefined;
  for (const { step, index } of order) {
    const last = dots.at(-1);
    const wait = step.kind === 'wait';
    // why: waits back to back are one pause, so they make one hollow dot however far apart they start.
    if (last && ((wait && last.kind === 'wait') || ((step.at - last.at) / duration) * width < gap))
      dots[dots.length - 1] = joined(last, step);
    else {
      if (last && !last.span) last.until = step.at;
      dots.push(newDot(step, index, duration, wait ? action : undefined));
    }
    if (!wait) action = step.label;
  }
  return dots;
}

/** A dot for `step` alone, lasting to the end of the recording until the next dot says otherwise. */
function newDot(step: DotMark, index: number, duration: number, after: string | undefined): StepDot {
  const { span } = step;
  const wait = step.kind === 'wait';
  return {
    index,
    at: step.at,
    label: step.label,
    kind: step.kind,
    count: 1,
    actions: wait ? 0 : 1,
    seek: span?.from ?? step.at,
    until: span?.to ?? duration,
    span,
    ...(after ? { after } : {}),
  };
}

/** `dot` once `step` joins it (too close to tell apart, or a wait right after its wait); an action names a wait dot. */
function joined(dot: StepDot, step: DotMark): StepDot {
  const length = (span: DotMark['span']) => (span ? span.to - span.from : 0);
  if (step.kind === 'wait')
    return { ...dot, count: dot.count + 1, ...(dot.kind === 'wait' ? {} : { pause: (dot.pause ?? 0) + length(step.span) }) };
  const named =
    dot.kind === 'wait'
      ? { kind: step.kind, label: step.label, after: undefined, span: undefined, at: step.at, seek: step.at, waitBefore: length(dot.span) }
      : {};
  return { ...dot, ...named, count: dot.count + 1, actions: dot.actions + 1 };
}

/**
 * A dot's tooltip and accessible label: an action's own words and how many more actions it stands for; a wait's
 * length and the action it follows ("Wait, 1.5 s, after Add the tea"). why: a wait merged into an action is that
 * action's pause, so it is not counted as another step.
 */
export function stepDotLabel(dot: StepDot, { spoken = false } = {}) {
  if (dot.kind === 'wait') {
    const length = waitSeconds(dot.until - dot.seek);
    const pause = spoken ? `Wait of ${length} seconds` : `Wait, ${length}\u00a0s`;
    if (!dot.after) return pause;
    return spoken ? `${pause} after ${dot.after.trim()}` : `${pause}, after ${dot.after.trim()}`;
  }
  const label = dot.label.trim() || 'Step';
  const more = dot.actions - 1;
  if (more <= 0) return label;
  return `${label} and ${more} more ${more === 1 ? 'step' : 'steps'}`;
}

/**
 * The rest of a dot's tooltip, which says why it is filled or hollow: an action names its kind and time
 * ("Click, 0:03.2"), a wait where it starts and ends, and `meaning` says in plain words what that dot's
 * shape stands for. `spoken` is the kind and time for a screen reader.
 */
export function stepDotDetail(
  dot: Pick<StepDot, 'kind' | 'seek' | 'until' | 'pause' | 'waitBefore'>,
  kindName: string,
  clock: (ms: number) => string,
) {
  if (dot.kind === 'wait')
    return { visible: `${clock(dot.seek)} to ${clock(dot.until)}`, meaning: 'Hollow dots are waits', spoken: `from ${clock(dot.seek)}` };
  const before = dot.waitBefore ? `, after a ${waitSeconds(dot.waitBefore)}\u00a0s wait` : '';
  const then = dot.pause ? `, then a ${waitSeconds(dot.pause)}\u00a0s wait` : '';
  const spokenThen = `${dot.waitBefore ? `, after a wait of ${waitSeconds(dot.waitBefore)} seconds` : ''}${dot.pause ? `, then a wait of ${waitSeconds(dot.pause)} seconds` : ''}`;
  return {
    visible: `${kindName}, ${clock(dot.seek)}${before}${then}`,
    meaning: 'Filled dots are actions',
    spoken: `${kindName} at ${clock(dot.seek)}${spokenThen}`,
  };
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
 * first word never reads as something else); a wait the Waits tool's hourglass and its kept length ("1.5 s"), the
 * else nothing (never the hourglass alone, which reads as an icon stub), so every wait reads the same on both.
 */
export function segmentText(segment: StepSegment, kept: number, width: number, room: LabelRoom) {
  if (!segment.wait) return { glyph: false, text: wordsThatFit(segment.label, width, { minWords: 2, ...room }) };
  const text = wordsThatFit(`${waitSeconds(kept)}\u00a0s`, width - WAIT_GLYPH_PX, { ...room, lines: 1 });
  return { glyph: text !== '', text };
}
