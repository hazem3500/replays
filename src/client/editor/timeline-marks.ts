import type { ReplayStep } from '../../shared/replay.ts';
import { wordsThatFit, type LabelRoom } from './block-label.ts';
import { lengthLabel, type StepSegment, waitSeconds } from './clip-segments.ts';

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
  /** When the next dot's step starts, or the recording ends: where a wait dot's pause stops. */
  until: number;
  /** The action a wait dot follows, when there is one before it. */
  after?: string | undefined;
}

/** Dots closer than this many px merge, so every dot keeps a 24 px target that no other overlaps. */
export const MIN_DOT_GAP_PX = 24;

/**
 * The recording's steps as ruler dots, in time order, for a ruler `width` px wide over `duration`. Steps closer than
 * `gap` px join the dot before them, which seeks to the first, is named by the first action among them (a wait only
 * when all are waits) and counts the rest. Steps outside the recording are left out.
 */
export function placeStepDots(steps: readonly ReplayStep[], duration: number, width: number, gap = MIN_DOT_GAP_PX): StepDot[] {
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
      if (last) last.until = step.at;
      const dot: StepDot = { index, at: step.at, label: step.label, kind: step.kind, count: 1, actions: wait ? 0 : 1, until: duration };
      if (wait && action) dot.after = action;
      dots.push(dot);
    }
    if (!wait) action = step.label;
  }
  return dots;
}

/** `dot` once `step` joins it (too close to tell apart, or a wait right after its wait); an action names a wait dot. */
function joined(dot: StepDot, step: ReplayStep): StepDot {
  if (step.kind === 'wait') return { ...dot, count: dot.count + 1 };
  const named = dot.kind === 'wait' ? { kind: step.kind, label: step.label, after: undefined } : {};
  return { ...dot, ...named, count: dot.count + 1, actions: dot.actions + 1 };
}

/**
 * A dot's tooltip and accessible label: an action's own words and how many more actions it stands for; a wait's
 * length and the action it follows ("Wait, 1.5 s, after Add the tea"). why: a wait merged into an action is that
 * action's pause, so it is not counted as another step.
 */
export function stepDotLabel(dot: StepDot, { spoken = false } = {}) {
  if (dot.kind === 'wait') {
    const pause = spoken ? `Wait of ${waitSeconds(dot.until - dot.at)} seconds` : `Wait, ${waitSeconds(dot.until - dot.at)} s`;
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
export function stepDotDetail(dot: Pick<StepDot, 'kind' | 'at' | 'until'>, kindName: string, clock: (ms: number) => string) {
  if (dot.kind === 'wait')
    return {
      visible: `${clock(dot.at)} to ${clock(dot.until)}`,
      meaning: 'Hollow dots are waits, when nothing happens',
      spoken: `from ${clock(dot.at)}`,
    };
  return { visible: `${kindName}, ${clock(dot.at)}`, meaning: 'Filled dots are actions', spoken: `${kindName} at ${clock(dot.at)}` };
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

/**
 * What a clip segment shows in `width` px: a step's leading whole words; a wait its kept length on one line, "Wait 1.5 s",
 * else just "1.5 s", else nothing, so every wait reads the same way.
 */
export function segmentText(segment: StepSegment, kept: number, width: number, room: LabelRoom) {
  if (!segment.wait) return wordsThatFit(segment.label, width, room);
  const named = lengthLabel('Wait', kept);
  if (wordsThatFit(named, width, { ...room, lines: 1 }) === named) return named;
  return wordsThatFit(`${waitSeconds(kept)}\u00a0s`, width, { ...room, lines: 1 });
}
