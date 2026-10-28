import type { ReplayBundle, ReplayPerformanceTrack } from '../../../shared/replay.ts';
import { formatDuration, type NetworkRow } from '../network/model.ts';
import { buildPerformance, type PerformanceSignal } from '../performance.ts';
import { validDuration } from '../waterfall.ts';

export type Verdict = 'good' | 'needs-work' | 'poor';
/** [good at or under, poor over], in ms. */
export type Budget = readonly [number, number];
export type VitalId = 'fcp' | 'lcp' | 'interaction' | 'task' | 'tbt';

/**
 * Web Vitals thresholds where they exist (FCP, LCP, INP for interactions, TBT); a long task is judged against the
 * 100 ms a person notices, since every captured task is already over the 50 ms that makes it "long".
 */
export const BUDGETS: Readonly<Record<VitalId, Budget>> = {
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  interaction: [200, 500],
  task: [100, 250],
  tbt: [200, 600],
};

export const VERDICT_WORDS: Readonly<Record<Verdict, string>> = { good: 'Good', 'needs-work': 'Needs work', poor: 'Poor' };

export function verdictFor(value: number, [good, poor]: Budget): Verdict {
  if (value <= good) return 'good';
  return value <= poor ? 'needs-work' : 'poor';
}

/** A slow stretch someone felt: one interaction (its pointer, key and click events together) or one long task. */
export interface Moment {
  id: string;
  kind: 'interaction' | 'task';
  label: string;
  /** Start and end on the player's clock. */
  at: number;
  end: number;
  /** Captured duration, ms. */
  value: number;
  verdict: Verdict;
  /** How far toward the poor line: 1 is on it. */
  severity: number;
}

/** The capture keeps one entry per event type; events this close with the same duration are one interaction. */
const SAME_INTERACTION_MS = 50;

const CLICKS = new Set(['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'auxclick', 'contextmenu']);
const KEYS = new Set(['keydown', 'keyup', 'keypress']);
const TYPING = new Set(['input', 'beforeinput', 'compositionend']);

export function interactionLabel(events: readonly string[]) {
  if (events.some((event) => CLICKS.has(event))) return 'Click';
  if (events.some((event) => TYPING.has(event))) return 'Typing';
  if (events.some((event) => KEYS.has(event))) return 'Key press';
  const first = events[0] ?? 'interaction';
  return `${first[0]?.toUpperCase() ?? ''}${first.slice(1)}`;
}

function spanEnd(signal: PerformanceSignal, value: number) {
  return signal.segments.at(-1)?.to ?? signal.at + value;
}

function moment(kind: Moment['kind'], signal: PerformanceSignal, value: number, label: string): Moment {
  const budget = kind === 'task' ? BUDGETS.task : BUDGETS.interaction;
  return {
    id: signal.id,
    kind,
    label,
    at: signal.at,
    end: spanEnd(signal, value),
    value,
    verdict: verdictFor(value, budget),
    severity: value / budget[1],
  };
}

/** Long tasks and grouped interactions, in time order. Paints are milestones, not moments: they live in the vitals. */
export function buildMoments(signals: readonly PerformanceSignal[]): Moment[] {
  const moments: Moment[] = [];
  let open: { signal: PerformanceSignal; events: string[] } | undefined;
  const close = () => {
    if (open) moments.push(moment('interaction', open.signal, open.signal.entry.value, interactionLabel(open.events)));
    open = undefined;
  };
  for (const signal of signals.toSorted((a, b) => a.at - b.at)) {
    const value = signal.entry.value;
    if (!validDuration(value)) continue;
    if (signal.entry.kind === 'long-task') moments.push(moment('task', signal, value, 'Long task'));
    if (signal.entry.kind !== 'slow-interaction') continue;
    const joins = open && open.signal.entry.value === value && signal.at - open.signal.at <= SAME_INTERACTION_MS;
    if (!joins) close();
    if (open) open.events.push(signal.entry.eventType ?? '');
    else open = { signal, events: [signal.entry.eventType ?? ''] };
  }
  close();
  return moments.toSorted((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

const VERDICT_RANK: Readonly<Record<Verdict, number>> = { poor: 0, 'needs-work': 1, good: 2 };

export type MomentOrder = 'worst' | 'time';

/** Worst first: Poor, then Needs work, then Good; within each, furthest toward the poor line; then earliest. */
export function orderMoments(moments: readonly Moment[], order: MomentOrder) {
  if (order === 'time') return [...moments];
  return moments.toSorted((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.severity - a.severity || a.at - b.at);
}

const overlapping = (a: { at: number; end: number }, b: { at: number; end: number }) => a.at < b.end && b.at < a.end;

export type Cause =
  | { kind: 'task'; task: Moment }
  | { kind: 'network'; requests: readonly NetworkRow[] }
  | { kind: 'page' }
  | { kind: 'none' };

/**
 * What a moment most likely waited on, from timing alone (no script attribution is captured): an overlapping long
 * task blocked the main thread; else requests were in flight; else, for an interaction, the page's own code ran long.
 */
export function causeOf(target: Moment, moments: readonly Moment[], requests: readonly NetworkRow[]): Cause {
  const task = moments
    .filter((other) => other.kind === 'task' && other.id !== target.id && overlapping(other, target))
    .reduce<Moment | undefined>((longest, other) => (!longest || other.value > longest.value ? other : longest), undefined);
  if (task && target.kind === 'interaction') return { kind: 'task', task };
  const inFlight = requests.filter((row) => overlapping({ at: row.at, end: Math.max(row.end, row.at + 1) }, target));
  if (inFlight.length) return { kind: 'network', requests: inFlight };
  return target.kind === 'interaction' ? { kind: 'page' } : { kind: 'none' };
}

/** The cause, as the end of a sentence ("a 182 ms long task blocked the page"); empty when there is none. */
export function causeText(cause: Cause) {
  switch (cause.kind) {
    case 'task':
      return `a ${formatDuration(cause.task.value)} long task blocked the page`;
    case 'network':
      return cause.requests.length === 1 ? '1 request in flight' : `${cause.requests.length} requests in flight`;
    case 'page':
      return 'no request in flight: page code ran long';
    case 'none':
      return '';
  }
}

export interface Vital {
  id: VitalId;
  value?: number | undefined;
  verdict?: Verdict | undefined;
  /** The moment the tile selects (the slowest interaction, the longest task). */
  moment?: Moment | undefined;
  /** Where the tile seeks to (a paint's time on the player's clock). */
  at?: number | undefined;
  /** Why there is no value: the observer was unavailable, or it watched and nothing crossed its threshold. */
  missing?: 'not-captured' | 'none' | undefined;
}

const OBSERVER: Readonly<Record<VitalId, string>> = {
  fcp: 'paint',
  lcp: 'largest-contentful-paint',
  interaction: 'event',
  task: 'longtask',
  tbt: 'longtask',
};

/** Blocking time: what every long task spent past 50 ms, summed (the TBT definition). */
export function totalBlockingTime(tasks: readonly Moment[]) {
  return tasks.reduce((sum, task) => sum + Math.max(0, task.value - 50), 0);
}

const worst = (moments: readonly Moment[]) =>
  moments.reduce<Moment | undefined>((top, other) => (!top || other.value > top.value ? other : top), undefined);

/** The vitals bar, from what was captured and nothing else: an unsupported observer is "Not captured", never 0. */
export function buildVitals(signals: readonly PerformanceSignal[], moments: readonly Moment[], track: ReplayPerformanceTrack | undefined) {
  const watched = (id: VitalId) => Boolean(track?.supported.includes(OBSERVER[id]));
  const judged = (id: VitalId, value: number | undefined, extra: Partial<Vital> = {}): Vital =>
    value === undefined
      ? { id, missing: watched(id) ? 'none' : 'not-captured' }
      : { id, value, verdict: verdictFor(value, BUDGETS[id]), ...extra };
  const paints = (kind: PerformanceSignal['entry']['kind']) =>
    signals.filter((signal) => signal.entry.kind === kind && validDuration(signal.entry.value)).toSorted((a, b) => a.sourceAt - b.sourceAt);
  const fcp = paints('first-contentful-paint')[0];
  // why: LCP is the latest candidate the browser reported, not the largest value.
  const lcp = paints('largest-contentful-paint').at(-1);
  const tasks = moments.filter((item) => item.kind === 'task');
  const interaction = worst(moments.filter((item) => item.kind === 'interaction'));
  const task = worst(tasks);
  const blocking = watched('tbt') || tasks.length ? totalBlockingTime(tasks) : undefined;
  return [
    judged('fcp', fcp?.entry.value, { at: fcp?.at }),
    judged('lcp', lcp?.entry.value, { at: lcp?.at }),
    judged('interaction', interaction?.value, { moment: interaction }),
    judged('task', task?.value, { moment: task }),
    judged('tbt', blocking),
  ];
}

/** A recording's vitals as it plays (another recording in compare mode). */
export function vitalsOf(bundle: ReplayBundle) {
  const signals = buildPerformance(bundle).signals;
  return buildVitals(signals, buildMoments(signals), bundle.performance);
}

/** Each vital's difference from another recording's (positive: this one is slower); undefined where either is missing. */
export function vitalDeltas(mine: readonly Vital[], theirs: readonly Vital[]) {
  return Object.fromEntries(
    mine.flatMap((vital) => {
      const other = theirs.find((candidate) => candidate.id === vital.id)?.value;
      return vital.value === undefined || other === undefined ? [] : [[vital.id, vital.value - other]];
    }),
  ) as Partial<Record<VitalId, number>>;
}

/** The Performance tab's badge: how many moments were over budget, in danger ink when any was poor. */
export function performanceBadge(moments: readonly Moment[]) {
  const over = moments.filter((item) => item.verdict !== 'good');
  const label = `${over.length} slow ${over.length === 1 ? 'moment' : 'moments'}`;
  return { value: over.length, tone: over.some((item) => item.verdict === 'poor') ? ('danger' as const) : ('warning' as const), label };
}
