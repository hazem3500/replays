import { fpsVerdict } from '../../../shared/frame-timing.ts';
import type { NetworkRow } from '../network/model.ts';
import type { LayoutShift } from '../performance.ts';
import type { FrameBand } from './frames.ts';
import { causeOf, type Moment, type Verdict, type Vital } from './model.ts';
import { shiftScore, shiftVerdict } from './stats.ts';
import { clockLabel } from './timeline-model.ts';

/** Where the headline points: its button seeks to `at` and lights the marks of `ids` on the timeline. */
export interface VerdictJump {
  label: string;
  at: number;
  ids: string[];
}

export interface PerformanceVerdict {
  /** The worst rating among the recording's moments, paints, frame rates and layout shifts; `good` when nothing was over budget. */
  tone: Verdict;
  headline: string;
  jump?: VerdictJump;
}

const RANK: Readonly<Record<Verdict, number>> = { good: 0, 'needs-work': 1, poor: 2 };
const worse = (a: Verdict, b: Verdict) => (RANK[a] >= RANK[b] ? a : b);

const NOUNS: Readonly<Record<string, [string, string]>> = {
  Click: ['a click', 'clicks'],
  Typing: ['typing', 'typing'],
  'Key press': ['a key press', 'key presses'],
};

function interactionNoun(slow: readonly Moment[]): [string, string] {
  const labels = new Set(slow.map((moment) => moment.label));
  const [only] = labels;
  return (labels.size === 1 && only ? NOUNS[only] : undefined) ?? ['an interaction', 'interactions'];
}

const byWorst = (moments: readonly Moment[]) => moments.toSorted((a, b) => b.severity - a.severity || a.at - b.at);

/** why: a headline about a cluster names its worst moment, so the button and the words point at the same place. */
function jumpTo(moments: readonly Moment[]): VerdictJump | undefined {
  const target = byWorst(moments)[0]?.at;
  return target === undefined ? undefined : { label: `Jump to ${clockLabel(target)}`, at: target, ids: moments.map((moment) => moment.id) };
}

function interactionHeadline(moments: readonly Moment[], requests: readonly NetworkRow[]) {
  const slow = moments.filter((moment) => moment.kind === 'interaction' && moment.verdict !== 'good');
  const [worst] = byWorst(slow);
  return worst ? describeInteractions(slow, worst, moments, requests) : undefined;
}

function describeInteractions(slow: readonly Moment[], worst: Moment, moments: readonly Moment[], requests: readonly NetworkRow[]) {
  const [one, many] = interactionNoun(slow);
  const blocked = slow.filter((moment) => causeOf(moment, moments, requests).kind === 'task').length;
  const jump = jumpTo(slow);
  const when = clockLabel(jump?.at ?? worst.at);
  const cause = (() => {
    if (slow.length === 1) return blocked ? `a long task blocked ${one}` : `${one} was slow`;
    if (blocked === slow.length) return `long tasks blocked ${slow.length} ${many}`;
    return blocked ? `${slow.length} slow ${many}, ${blocked} blocked by long tasks` : `${slow.length} slow ${many}`;
  })();
  return { headline: `Slow ${slow.length === 1 ? 'at' : 'around'} ${when}: ${cause}`, jump };
}

/** With no paint to say when loading ended, the first two seconds count as loading. */
const LOADING_WINDOW_MS = 2000;

/** Before the largest paint, or in the first two seconds while nobody has interacted yet: the page is still loading. */
function isLoading(at: number, moments: readonly Moment[], vitals: readonly Vital[]) {
  const painted = vitals.find((vital) => vital.id === 'lcp')?.at;
  if (painted !== undefined && at < painted) return true;
  const firstInteraction = Math.min(...moments.filter((moment) => moment.kind === 'interaction').map((moment) => moment.at));
  return at < LOADING_WINDOW_MS && at < firstInteraction;
}

function taskHeadline(moments: readonly Moment[], vitals: readonly Vital[]) {
  const slow = moments.filter((moment) => moment.kind === 'task' && moment.verdict !== 'good');
  return slow.length ? describeTasks(slow, moments, vitals) : undefined;
}

function describeTasks(slow: readonly Moment[], moments: readonly Moment[], vitals: readonly Vital[]) {
  const jump = jumpTo(slow);
  const at = jump?.at ?? 0;
  const cause = slow.length === 1 ? 'a long task blocked the page' : `${slow.length} long tasks blocked the page`;
  const lead = isLoading(at, moments, vitals) ? 'Slow while loading' : `Slow ${slow.length === 1 ? 'at' : 'around'} ${clockLabel(at)}`;
  return { headline: `${lead}: ${cause}`, jump };
}

function loadingHeadline(vitals: readonly Vital[]) {
  const slow = vitals.filter(
    (vital) => (vital.id === 'fcp' || vital.id === 'lcp') && vital.value !== undefined && vital.verdict && vital.verdict !== 'good',
  );
  const [worst] = slow.toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return worst ? describeLoading(worst) : undefined;
}

function describeLoading(worst: Vital) {
  const label = worst.id === 'lcp' ? 'largest paint' : 'first paint';
  return {
    headline: `Slow to load: the ${label} came late`,
    ...(worst.at === undefined ? {} : { jump: { label: `Jump to ${clockLabel(worst.at)}`, at: worst.at, ids: [] } }),
  };
}

function framesHeadline(frames: readonly FrameBand[]) {
  const [slowest] = frames.toSorted((a, b) => a.fps - b.fps);
  return slowest && fpsVerdict(slowest.fps) !== 'good' ? describeChoppy(slowest) : undefined;
}

function describeChoppy(slowest: FrameBand) {
  const at = (slowest.at + slowest.end) / 2;
  return { headline: `Choppy around ${clockLabel(at)}: the frame rate dropped`, jump: { label: `Jump to ${clockLabel(at)}`, at, ids: [] } };
}

function shiftHeadline(shifts: readonly LayoutShift[]) {
  const [biggest] = shifts.filter((shift) => !shift.hadRecentInput).toSorted((a, b) => b.value - a.value);
  return biggest && shiftVerdict(shiftScore(shifts)) !== 'good' ? describeShift(biggest) : undefined;
}

function describeShift(biggest: LayoutShift) {
  return {
    headline: `The layout jumped around ${clockLabel(biggest.at)}`,
    jump: { label: `Jump to ${clockLabel(biggest.at)}`, at: biggest.at, ids: [] },
  };
}

export interface VerdictInput {
  moments: readonly Moment[];
  vitals: readonly Vital[];
  frames: readonly FrameBand[];
  shifts: readonly LayoutShift[];
  requests: readonly NetworkRow[];
}

function toneOf({ moments, vitals, frames, shifts }: VerdictInput): Verdict {
  let tone: Verdict = 'good';
  for (const moment of moments) tone = worse(tone, moment.verdict);
  for (const vital of vitals) tone = worse(tone, vital.id === 'fcp' || vital.id === 'lcp' ? (vital.verdict ?? 'good') : 'good');
  for (const band of frames) tone = worse(tone, fpsVerdict(band.fps));
  return worse(tone, shiftVerdict(shiftScore(shifts)));
}

/**
 * One short headline naming the main problem and its cause: slow interactions and the long tasks that blocked them, else
 * long tasks, else a late paint, else the frame rate, else a layout shift. Everything else is already on the stats and the
 * timeline, so it is not repeated. It reads the same moments and vitals the stats do, so the two cannot disagree.
 */
export function buildVerdict(input: VerdictInput): PerformanceVerdict {
  const tone = toneOf(input);
  const found =
    interactionHeadline(input.moments, input.requests) ??
    taskHeadline(input.moments, input.vitals) ??
    loadingHeadline(input.vitals) ??
    framesHeadline(input.frames) ??
    shiftHeadline(input.shifts);
  if (!found) return { tone, headline: tone === 'good' ? 'No slowdowns found' : 'Slower than its budget in places' };
  return { tone, headline: found.headline, ...(found.jump ? { jump: found.jump } : {}) };
}
