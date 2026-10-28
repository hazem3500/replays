import type { ReplayBundle, ReplayPerformanceKind } from '../../shared/replay.ts';

type WithPerformance = Pick<ReplayBundle, 'performance'>;

export type CompareMetric = 'fcp' | 'lcp' | 'long-task' | 'interaction';

export const COMPARE_METRICS: readonly { id: CompareMetric; label: string; kind: ReplayPerformanceKind }[] = [
  { id: 'fcp', label: 'First paint', kind: 'first-contentful-paint' },
  { id: 'lcp', label: 'Largest paint', kind: 'largest-contentful-paint' },
  { id: 'long-task', label: 'Longest task', kind: 'long-task' },
  { id: 'interaction', label: 'Slowest interaction', kind: 'slow-interaction' },
];

/** Each metric in ms, or undefined when the recording never captured one (not captured is not fast). */
export type MetricValues = Record<CompareMetric, number | undefined>;

function valuesOf(bundle: WithPerformance, kind: ReplayPerformanceKind) {
  const entries = bundle.performance?.entries ?? [];
  return entries.filter((entry) => entry.kind === kind && Number.isFinite(entry.value));
}

function lastValue(bundle: WithPerformance, kind: ReplayPerformanceKind) {
  const ordered = valuesOf(bundle, kind).toSorted((a, b) => a.at - b.at);
  return ordered.at(-1)?.value;
}

function largestValue(bundle: WithPerformance, kind: ReplayPerformanceKind) {
  const values = valuesOf(bundle, kind).map((entry) => entry.value);
  if (!values.length) return;
  return Math.max(...values);
}

/** The worst value of each kind a recording captured: the last paint candidate, the longest task and interaction. */
export function metricValues(bundle: WithPerformance): MetricValues {
  return {
    fcp: valuesOf(bundle, 'first-contentful-paint')[0]?.value,
    lcp: lastValue(bundle, 'largest-contentful-paint'),
    'long-task': largestValue(bundle, 'long-task'),
    interaction: largestValue(bundle, 'slow-interaction'),
  };
}

/** Below this the difference is noise in a single capture, not a regression or a win. */
export const SAME_WITHIN_MS = 20;

export type DeltaTone = 'slower' | 'faster' | 'same';

function toneOf(difference: number): DeltaTone {
  if (Math.abs(difference) < SAME_WITHIN_MS) return 'same';
  return difference > 0 ? 'slower' : 'faster';
}

/** `value` against the baseline (the focused recording); undefined when either side was not captured. */
export function metricDelta(value: number | undefined, baseline: number | undefined) {
  if (value === undefined || baseline === undefined) return;
  const difference = value - baseline;
  return { difference, tone: toneOf(difference) };
}

export function metricLabel(ms: number) {
  const value = Math.abs(ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

/** "+1.20 s", "−48 ms", "Same": the sign says which way, the tone says whether that is worse. */
export function deltaLabel(delta: { difference: number; tone: DeltaTone }) {
  if (delta.tone === 'same') return 'Same';
  return `${delta.difference > 0 ? '+' : '−'}${metricLabel(delta.difference)}`;
}
