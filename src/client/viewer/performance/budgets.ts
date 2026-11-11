// why: a dependency-free home for the budgets so the suite sidebar can rate runs without bundling the whole
// performance model into its chunk.
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

export function verdictFor(value: number, [good, poor]: Budget): Verdict {
  if (value <= good) return 'good';
  return value <= poor ? 'needs-work' : 'poor';
}
