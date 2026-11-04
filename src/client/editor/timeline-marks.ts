import type { ReplayStep } from '../../shared/replay.ts';

/** rrweb's incremental snapshot type and the sources and interactions the clip's activity counts. */
const INCREMENTAL = 3;
const MOUSE_MOVE = 1;
const MOUSE_INTERACTION = 2;
const SCROLL = 3;
const INPUT = 5;
const TOUCH_MOVE = 6;
const DRAG = 12;
const CLICK = 2;
const TOUCH_END = 9;

/** why: a click or a keystroke is a deliberate act, so each outweighs the stream of pointer moves around it. */
const MOVE_WEIGHT = 1;
const SCROLL_WEIGHT = 1.5;
const INPUT_WEIGHT = 4;
const CLICK_WEIGHT = 6;

/** The clip's finest resolution: about one bar per 6 px on a desktop timeline. */
export const MAX_ACTIVITY_BINS = 160;
const MIN_ACTIVITY_BINS = 60;
const MS_PER_BIN = 50;
/** why: a share of each act spills into the two slices either side, so sparse activity reads as a hill, not a lone spike. */
const SPREAD = [0.5, 0.2];

/** Slices for a recording: one per 50 ms, kept between a short clip's legible bars and a long clip's finest. */
export function activityBinsFor(duration: number) {
  return Math.round(Math.min(MAX_ACTIVITY_BINS, Math.max(MIN_ACTIVITY_BINS, duration / MS_PER_BIN)));
}

/** One slice of the clip: its height in 0 to 1, and whether a click or typing happened in it. */
export interface ActivityBar {
  level: number;
  strong: boolean;
}

interface Weighed {
  weight: number;
  strong: boolean;
}

function weighOf(event: { type?: unknown; data?: unknown }): Weighed | undefined {
  if (event.type !== INCREMENTAL || typeof event.data !== 'object' || event.data === null) return undefined;
  const source: unknown = 'source' in event.data ? event.data.source : undefined;
  if (source === MOUSE_MOVE || source === TOUCH_MOVE || source === DRAG) return { weight: MOVE_WEIGHT, strong: false };
  if (source === SCROLL) return { weight: SCROLL_WEIGHT, strong: false };
  if (source === INPUT) return { weight: INPUT_WEIGHT, strong: true };
  if (source !== MOUSE_INTERACTION) return undefined;
  const kind: unknown = 'type' in event.data ? event.data.type : undefined;
  // invariant: only the click itself counts, so a press, its release and the focus it moves are one act, not four.
  return kind === CLICK || kind === TOUCH_END ? { weight: CLICK_WEIGHT, strong: true } : undefined;
}

/**
 * The recording's activity in `bins` equal slices of `duration` (ms from the first event): pointer moves, scrolls,
 * typing and clicks, weighted so the deliberate ones stand out, then log-scaled so one busy moment does not flatten
 * the rest. Only the slice a click or keystroke landed in is strong. Empty when nothing was done at all.
 */
export function activityBars(
  events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>,
  duration: number,
  bins = activityBinsFor(duration),
): ActivityBar[] {
  const weights = Array.from({ length: bins }, () => 0);
  const strong = Array.from({ length: bins }, () => false);
  const first = events[0]?.timestamp ?? 0;
  const span = Math.max(1, duration);
  let any = false;
  for (const event of events) {
    const weighed = weighOf(event);
    if (!weighed) continue;
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((event.timestamp - first) / span) * bins)));
    weights[index] = (weights[index] ?? 0) + weighed.weight;
    for (const [distance, share] of SPREAD.entries()) {
      for (const near of [index - distance - 1, index + distance + 1]) {
        if (near >= 0 && near < bins) weights[near] = (weights[near] ?? 0) + weighed.weight * share;
      }
    }
    if (weighed.strong) strong[index] = true;
    any = true;
  }
  if (!any) return [];
  const top = Math.log1p(Math.max(...weights));
  return weights.map((weight, index) => ({ level: Math.log1p(weight) / top, strong: strong[index] ?? false }));
}

const cache = new WeakMap<object, { duration: number; bars: readonly ActivityBar[] }>();

/** activityBars, worked out once per recording: the timeline redraws on every edit, the recording never changes. */
export function activityOf(events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>, duration: number) {
  const cached = cache.get(events);
  if (cached?.duration === duration) return cached.bars;
  const bars = activityBars(events, duration);
  cache.set(events, { duration, bars });
  return bars;
}

/** For each of `count` equal slices of `duration`, whether the edits remove it (its middle lies in a cut or a trimmed end). */
export function removedSlices(count: number, duration: number, isRemoved: (time: number) => boolean) {
  return Array.from({ length: count }, (_, index) => isRemoved(((index + 0.5) / count) * duration));
}

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
}

/** Dots closer than this many px merge, so every dot keeps a clear target of its own. */
export const MIN_DOT_GAP_PX = 12;

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
    dots.push({ index, at: step.at, label: step.label, kind: step.kind, count: 1, actions: step.kind === 'wait' ? 0 : 1 });
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
