import type { ReplayPerformanceKind } from '../replay.ts';

export type Verdict = 'good' | 'needs-improvement' | 'poor';
export type VitalId = 'lcp' | 'fcp' | 'interaction' | 'long-task' | 'tbt';

/** `[good, poor]`: at or under `good` is Good, over `poor` is Poor. Data, so a host or purpose can tune them later. */
export type Budget = readonly [good: number, poor: number];
export type Budgets = Readonly<Record<VitalId, Budget>>;

export const DEFAULT_BUDGETS: Budgets = {
  lcp: [2500, 4000],
  fcp: [1800, 3000],
  interaction: [200, 500],
  'long-task': [50, 250],
  tbt: [200, 600],
};

/** A long task's blocking part: the main thread is only "busy" past 50 ms. */
export const BLOCKING_THRESHOLD = 50;
/** The recorder keeps interactions at or over this (durationThreshold), so fewer is not "none happened". */
export const INTERACTION_CAPTURE_THRESHOLD = 40;

export const BUDGET_FOR_KIND: Readonly<Record<ReplayPerformanceKind, VitalId>> = {
  'largest-contentful-paint': 'lcp',
  'first-contentful-paint': 'fcp',
  'slow-interaction': 'interaction',
  'long-task': 'long-task',
};

/** The PerformanceObserver type that had to be supported for a kind to be captured. */
export const OBSERVER_FOR_KIND: Readonly<Record<ReplayPerformanceKind, string>> = {
  'largest-contentful-paint': 'largest-contentful-paint',
  'first-contentful-paint': 'paint',
  'slow-interaction': 'event',
  'long-task': 'longtask',
};

export const isDuration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function verdictFor(value: number, [good, poor]: Budget): Verdict {
  if (value <= good) return 'good';
  return value > poor ? 'poor' : 'needs-improvement';
}

/** How far toward its own Poor line a value is: a 300 ms task (1.2) outranks a 3 s LCP (0.75). */
export function severity(value: number, [, poor]: Budget) {
  return poor > 0 ? value / poor : 0;
}

/** Total blocking time: Σ max(0, task − 50 ms) over the captured long tasks. */
export function totalBlockingTime(taskDurations: readonly number[]) {
  return taskDurations.reduce((sum, value) => sum + (isDuration(value) ? Math.max(0, value - BLOCKING_THRESHOLD) : 0), 0);
}
