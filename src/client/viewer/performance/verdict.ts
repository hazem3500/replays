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

function medianOf(moments: readonly Moment[]) {
  const sorted = moments.toSorted((a, b) => a.at - b.at);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function jumpTo(moments: readonly Moment[], at?: number): VerdictJump | undefined {
  const target = at ?? medianOf(moments)?.at;
  return target === undefined ? undefined : { label: `Jump to ${clockLabel(target)}`, at: target, ids: moments.map((moment) => moment.id) };
}

function interactionHeadline(moments: readonly Moment[], requests: readonly NetworkRow[]) {
  const slow = moments.filter((moment) => moment.kind === 'interaction' && moment.verdict !== 'good');
  const [worst] = byWorst(slow);
  if (!worst) return undefined;
  const [one, many] = interactionNoun(slow);
  const blocked = slow.filter((moment) => causeOf(moment, moments, requests).kind === 'task').length;
  const jump = jumpTo(slow, slow.length === 1 ? worst.at : undefined);
  const when = clockLabel(jump?.at ?? worst.at);
  const cause = (() => {
    if (slow.length === 1) return blocked ? `a long task blocked ${one}` : `${one} was slow`;
    if (blocked === slow.length) return `long tasks blocked ${slow.length} ${many}`;
    return blocked ? `${slow.length} slow ${many}, ${blocked} blocked by long tasks` : `${slow.length} slow ${many}`;
  })();
  return { headline: `Slow ${slow.length === 1 ? 'at' : 'around'} ${when}: ${cause}`, jump };
}

function taskHeadline(moments: readonly Moment[]) {
  const slow = moments.filter((moment) => moment.kind === 'task' && moment.verdict !== 'good');
  if (!slow.length) return undefined;
  const jump = jumpTo(slow, slow.length === 1 ? slow[0]?.at : undefined);
  const when = clockLabel(jump?.at ?? 0);
  const cause = slow.length === 1 ? 'a long task blocked the page' : `${slow.length} long tasks blocked the page`;
  return { headline: `Slow ${slow.length === 1 ? 'at' : 'around'} ${when}: ${cause}`, jump };
}

function loadingHeadline(vitals: readonly Vital[]) {
  const slow = vitals.filter((vital) => (vital.id === 'fcp' || vital.id === 'lcp') && vital.value !== undefined && vital.verdict && vital.verdict !== 'good');
  const worst = slow.toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (!worst) return undefined;
  const label = worst.id === 'lcp' ? 'largest paint' : 'first paint';
  return { headline: `Slow to load: the ${label} came late`, ...(worst.at === undefined ? {} : { jump: { label: `Jump to ${clockLabel(worst.at)}`, at: worst.at, ids: [] } }) };
}

function framesHeadline(frames: readonly FrameBand[]) {
  const slowest = frames.reduce<FrameBand | undefined>((low, band) => (!low || band.fps < low.fps ? band : low), undefined);
  if (!slowest || fpsVerdict(slowest.fps) === 'good') return undefined;
  const at = (slowest.at + slowest.end) / 2;
  return { headline: `Choppy around ${clockLabel(at)}: the frame rate dropped`, jump: { label: `Jump to ${clockLabel(at)}`, at, ids: [] } };
}

function shiftHeadline(shifts: readonly LayoutShift[]) {
  if (shiftVerdict(shiftScore(shifts)) === 'good') return undefined;
  const [biggest] = shifts.filter((shift) => !shift.hadRecentInput).toSorted((a, b) => b.value - a.value);
  if (!biggest) return undefined;
  return { headline: `The layout jumped around ${clockLabel(biggest.at)}`, jump: { label: `Jump to ${clockLabel(biggest.at)}`, at: biggest.at, ids: [] } };
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
    taskHeadline(input.moments) ??
    loadingHeadline(input.vitals) ??
    framesHeadline(input.frames) ??
    shiftHeadline(input.shifts);
  if (!found) return { tone, headline: tone === 'good' ? 'No slowdowns found' : 'Slower than its budget in places' };
  return { tone, headline: found.headline, ...(found.jump ? { jump: found.jump } : {}) };
}
