import { fpsVerdict } from '../../../shared/frame-timing.ts';
import { formatDuration, type NetworkRow } from '../network/model.ts';
import type { LayoutShift } from '../performance.ts';
import type { FrameBand } from './frames.ts';
import { causeOf, type Moment, type Verdict, type Vital } from './model.ts';
import { shiftScore, shiftVerdict } from './stats.ts';
import { clockLabel } from './timeline-model.ts';

/** A piece of the verdict sentence: plain text, or a phrase that seeks to a time and, for a moment, selects it. */
export type VerdictPart = { text: string; at?: number; momentId?: string };

export interface PerformanceVerdict {
  /** The worst rating among the things the sentence names; `good` when nothing was over budget. */
  tone: Verdict;
  parts: VerdictPart[][];
}

const RANK: Readonly<Record<Verdict, number>> = { good: 0, 'needs-work': 1, poor: 2 };
const worse = (a: Verdict, b: Verdict) => (RANK[a] >= RANK[b] ? a : b);

const NOUNS: Readonly<Record<string, [string, string]>> = {
  Click: ['click', 'clicks'],
  Typing: ['typing', 'typing'],
  'Key press': ['key press', 'key presses'],
};

function interactionNoun(slow: readonly Moment[]): [string, string] {
  const labels = new Set(slow.map((moment) => moment.label));
  const [only] = labels;
  return (labels.size === 1 && only ? NOUNS[only] : undefined) ?? ['interaction', 'interactions'];
}

const byWorst = (moments: readonly Moment[]) => moments.toSorted((a, b) => b.severity - a.severity || a.at - b.at);

function medianAt(moments: readonly Moment[]) {
  const times = moments.map((moment) => moment.at).toSorted((a, b) => a - b);
  return times[Math.floor((times.length - 1) / 2)] ?? 0;
}

function interactionSentence(moments: readonly Moment[], requests: readonly NetworkRow[]): VerdictPart[] {
  const slow = moments.filter((moment) => moment.kind === 'interaction' && moment.verdict !== 'good');
  const [worst] = byWorst(slow);
  if (!worst) return [];
  const blocked = slow.filter((moment) => causeOf(moment, moments, requests).kind === 'task').length;
  const noun = interactionNoun(slow);
  const when = slow.length === 1 ? worst.at : medianAt(slow);
  const parts: VerdictPart[] = [
    { text: slow.length === 1 ? `A slow ${noun[0]}` : `${slow.length} slow ${noun[1]}`, at: worst.at, momentId: worst.id },
    { text: `${slow.length === 1 ? ' at ' : ' around '}${clockLabel(when)}` },
  ];
  if (blocked) {
    const all = blocked === slow.length;
    const who = all ? (slow.length === 1 ? 'blocked by a long task' : slow.length === 2 ? 'both blocked by long tasks' : 'all blocked by long tasks') : `${blocked} blocked by long tasks`;
    parts.push({ text: `, ${who}` });
  }
  return parts;
}

function taskSentence(moments: readonly Moment[]): VerdictPart[] {
  const slow = moments.filter((moment) => moment.kind === 'task' && moment.verdict !== 'good');
  const [worst] = byWorst(slow);
  if (!worst) return [];
  return [
    { text: `${slow.length} long ${slow.length === 1 ? 'task' : 'tasks'} over budget`, at: worst.at, momentId: worst.id },
    { text: `, longest ${formatDuration(worst.value)}` },
  ];
}

function frameSentence(frames: readonly FrameBand[]): VerdictPart[] {
  const slowest = frames.reduce<FrameBand | undefined>((low, band) => (!low || band.fps < low.fps ? band : low), undefined);
  if (!slowest || fpsVerdict(slowest.fps) === 'good') return [];
  return [{ text: `Frame rate fell to ${Math.round(slowest.fps)} fps around ${clockLabel((slowest.at + slowest.end) / 2)}`, at: slowest.at }];
}

function shiftSentence(shifts: readonly LayoutShift[]): VerdictPart[] {
  const score = shiftScore(shifts);
  if (shiftVerdict(score) === 'good') return [];
  const [biggest] = shifts.toSorted((a, b) => b.value - a.value);
  return [{ text: `Layout shift score ${score.toFixed(2)}`, ...(biggest ? { at: biggest.at } : {}) }];
}

function loadingSentence(vitals: readonly Vital[]): VerdictPart[] {
  const slow = vitals.filter((vital) => (vital.id === 'fcp' || vital.id === 'lcp') && vital.value !== undefined && vital.verdict && vital.verdict !== 'good');
  const worst = slow.toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (!worst || worst.value === undefined) return [];
  const label = worst.id === 'lcp' ? 'Largest paint' : 'First paint';
  return [{ text: `${label} came at ${formatDuration(worst.value)}`, ...(worst.at === undefined ? {} : { at: worst.at }) }];
}

function verdictOf({ moments, vitals, frames, shifts }: VerdictInput): Verdict {
  let tone: Verdict = 'good';
  for (const moment of moments) tone = worse(tone, moment.verdict);
  for (const vital of vitals) tone = worse(tone, vital.id === 'fcp' || vital.id === 'lcp' ? (vital.verdict ?? 'good') : 'good');
  for (const band of frames) tone = worse(tone, fpsVerdict(band.fps));
  return worse(tone, shiftVerdict(shiftScore(shifts)));
}

export interface VerdictInput {
  moments: readonly Moment[];
  vitals: readonly Vital[];
  frames: readonly FrameBand[];
  shifts: readonly LayoutShift[];
  requests: readonly NetworkRow[];
}

/**
 * One plain sentence answering "was this slow, where, and why": the slow interactions and what blocked them, long tasks
 * past budget, slow paints, the slowest frame rate, the layout shift score. Each phrase that names a time seeks to it.
 */
export function buildVerdict(input: VerdictInput): PerformanceVerdict {
  const { moments, vitals, frames, shifts, requests } = input;
  const interaction = interactionSentence(moments, requests);
  const sentences = [
    interaction.length ? interaction : taskSentence(moments),
    // why: a slow interaction's blocking tasks are already in its sentence; naming them again would count one stall twice.
    ...(interaction.length ? [taskSentence(moments.filter((moment) => moment.kind === 'task' && causeFree(moment, moments, requests)))] : []),
    loadingSentence(vitals),
    frameSentence(frames),
    shiftSentence(shifts),
  ].filter((parts) => parts.length > 0);
  const tone = verdictOf(input);
  if (sentences.length) return { tone, parts: sentences };
  return { tone, parts: [[{ text: frames.length ? 'Nothing slow: no moment over budget and a steady frame rate' : 'Nothing slow: no moment over budget' }]] };
}

function causeFree(task: Moment, moments: readonly Moment[], requests: readonly NetworkRow[]) {
  return !moments.some((moment) => moment.kind === 'interaction' && moment.verdict !== 'good' && causeOf(moment, moments, requests).kind === 'task' && overlaps(moment, task));
}

const overlaps = (a: Moment, b: Moment) => a.at < b.end && b.at < a.end;
