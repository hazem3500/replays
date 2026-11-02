import type { ReplayPerformanceKind, ReplayPerformanceTrack } from '../../../shared/replay.ts';
import {
  BUDGET_FOR_KIND,
  DEFAULT_BUDGETS,
  OBSERVER_FOR_KIND,
  severity,
  totalBlockingTime,
  verdictFor,
  type Budget,
  type Budgets,
  type Verdict,
  type VitalId,
} from '../../../shared/diagnostics/budgets.ts';
import { validDuration, type WaterfallRow } from '../waterfall.ts';

export * from '../../../shared/diagnostics/budgets.ts';

export type PerformanceSignal = Extract<WaterfallRow, { kind: 'performance' }>;

export interface SignalVerdict {
  row: PerformanceSignal;
  value: number;
  budget: Budget;
  verdict: Verdict;
  severity: number;
}

/** A captured signal judged against its kind's budget; undefined when its value is unusable. */
export function judgeSignal(row: PerformanceSignal, budgets: Budgets = DEFAULT_BUDGETS): SignalVerdict | undefined {
  const value = row.entry.value;
  if (!validDuration(value)) return;
  const budget = budgets[BUDGET_FOR_KIND[row.entry.kind]];
  return { row, value, budget, verdict: verdictFor(value, budget), severity: severity(value, budget) };
}

export interface Vital {
  id: VitalId;
  /** Signals the tile filters the table to. */
  kind: ReplayPerformanceKind;
  value?: number;
  verdict?: Verdict;
  /** The event the tile selects: the worst (or, for LCP, the latest) candidate. */
  worst?: PerformanceSignal;
  /** Why there is no value: the observer was unavailable, or nothing crossed the capture threshold. */
  missing?: 'not-captured' | 'none';
}

/**
 * The vitals strip's numbers, from what was captured and nothing else: an unsupported observer is "Not captured", never 0.
 * Signals are the ones still on the (edited) timeline; values keep their captured meaning.
 */
export function buildVitals(
  signals: readonly PerformanceSignal[],
  track: ReplayPerformanceTrack | undefined,
  budgets: Budgets = DEFAULT_BUDGETS,
): Vital[] {
  const supported = (kind: ReplayPerformanceKind) => Boolean(track?.supported.includes(OBSERVER_FOR_KIND[kind]));
  const of = (kind: ReplayPerformanceKind) => signals.filter((row) => row.entry.kind === kind && validDuration(row.entry.value));
  const worstOf = (rows: readonly PerformanceSignal[]) =>
    rows.reduce<PerformanceSignal | undefined>((worst, row) => (!worst || row.entry.value > worst.entry.value ? row : worst), undefined);
  const judged = (id: VitalId, kind: ReplayPerformanceKind, value: number | undefined, worst: PerformanceSignal | undefined): Vital => {
    if (value !== undefined) return { id, kind, value, verdict: verdictFor(value, budgets[id]), ...(worst ? { worst } : {}) };
    return { id, kind, missing: supported(kind) ? 'none' : 'not-captured' };
  };
  // why: LCP is the latest candidate, not the largest value.
  const lcp = of('largest-contentful-paint').reduce<PerformanceSignal | undefined>(
    (latest, row) => (!latest || row.sourceAt >= latest.sourceAt ? row : latest),
    undefined,
  );
  const fcp = of('first-contentful-paint')[0];
  const interaction = worstOf(of('slow-interaction'));
  const tasks = of('long-task');
  const task = worstOf(tasks);
  const tbtValue = supported('long-task') || tasks.length ? totalBlockingTime(tasks.map((row) => row.entry.value)) : undefined;
  return [
    judged('lcp', 'largest-contentful-paint', lcp?.entry.value, lcp),
    judged('fcp', 'first-contentful-paint', fcp?.entry.value, fcp),
    judged('interaction', 'slow-interaction', interaction?.entry.value, interaction),
    // why: a supported observer with no long task is a real, good zero for TBT; the longest task stays "None".
    judged('long-task', 'long-task', task?.entry.value, task),
    tbtValue === undefined ? { id: 'tbt', kind: 'long-task', missing: 'not-captured' } : judged('tbt', 'long-task', tbtValue, task),
  ];
}

const VERDICT_RANK: Readonly<Record<Verdict, number>> = { poor: 0, 'needs-improvement': 1, good: 2 };

/** Worst first: Poor, then Needs work, then Good; within each, by how far toward Poor; then earliest. */
export function byWorst(a: SignalVerdict, b: SignalVerdict) {
  return (
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.severity - a.severity || a.row.at - b.row.at || a.row.id.localeCompare(b.row.id)
  );
}
