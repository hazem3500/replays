import type { ReplayStep } from '../../shared/replay.ts';

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
  for (const { step, index } of order) {
    const last = dots.at(-1);
    if (last && ((step.at - last.at) / duration) * width < gap) {
      last.count += 1;
      if (step.kind === 'wait') continue;
      last.actions += 1;
      if (last.kind === 'wait') Object.assign(last, { kind: step.kind, label: step.label });
      continue;
    }
    if (last) last.until = step.at;
    dots.push({ index, at: step.at, label: step.label, kind: step.kind, count: 1, actions: step.kind === 'wait' ? 0 : 1, until: duration });
  }
  return dots;
}

/**
 * A dot's tooltip and accessible label: its step's own words, and how many more actions it stands for. why: a wait
 * merged into an action is that action's pause, so it is not counted as another step.
 */
export function stepDotLabel(dot: StepDot) {
  const label = dot.label.trim() || 'Step';
  const more = dot.kind === 'wait' ? dot.count - 1 : dot.actions - 1;
  if (more <= 0) return label;
  return `${label} and ${more} more ${more === 1 ? 'step' : 'steps'}`;
}

/**
 * The rest of a dot's tooltip, which says why it is filled or hollow: an action names its kind and time
 * ("Click, 0:03.2"), a wait how long it pauses ("Wait, 2.1 s"), and `meaning` says in plain words what that dot's
 * shape stands for. `spoken` is the kind and time for a screen reader.
 */
export function stepDotDetail(dot: Pick<StepDot, 'kind' | 'at' | 'until'>, kindName: string, clock: (ms: number) => string) {
  if (dot.kind === 'wait') {
    const seconds = (Math.max(0, dot.until - dot.at) / 1000).toFixed(1);
    return {
      visible: `${kindName}, ${seconds} s`,
      meaning: 'Hollow dots are pauses, when nothing happens',
      spoken: `${kindName} of ${seconds} seconds at ${clock(dot.at)}`,
    };
  }
  return { visible: `${kindName}, ${clock(dot.at)}`, meaning: 'Filled dots are actions', spoken: `${kindName} at ${clock(dot.at)}` };
}

/**
 * The kept part of each step (from its start to the next step's), in ms from the trim start: the clip's labelled
 * segments on the desktop and the phone. Empty and trimmed-off segments are left out, so the starts that remain are distinct.
 */
export function stepSegments(steps: readonly Pick<ReplayStep, 'at' | 'label'>[], trim: { start: number; end: number }) {
  return steps.flatMap((step, index) => {
    const from = Math.max(step.at, trim.start);
    const to = Math.min(steps[index + 1]?.at ?? trim.end, trim.end);
    return to > from ? [{ at: step.at, offset: from - trim.start, length: to - from, label: step.label }] : [];
  });
}
