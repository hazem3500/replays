import type { ReplayBundle, ReplayPerformanceKind } from '../../shared/replay.ts';

export type CompareMetric = 'fcp' | 'lcp' | 'long-task' | 'interaction';

export const COMPARE_METRICS: readonly { id: CompareMetric; label: string; kind: ReplayPerformanceKind }[] = [
  { id: 'fcp', label: 'First paint', kind: 'first-contentful-paint' },
  { id: 'lcp', label: 'Largest paint', kind: 'largest-contentful-paint' },
  { id: 'long-task', label: 'Longest task', kind: 'long-task' },
  { id: 'interaction', label: 'Slowest interaction', kind: 'slow-interaction' },
];

/** Each metric in ms, or undefined when the recording never captured one (not captured is not fast). */
export type MetricValues = Record<CompareMetric, number | undefined>;

/** The worst value of each kind a recording captured: the last paint candidate, the longest task and interaction. */
export function metricValues(bundle: ReplayBundle): MetricValues {
  const entries = bundle.performance?.entries ?? [];
  const of = (kind: ReplayPerformanceKind) => entries.filter((entry) => entry.kind === kind && Number.isFinite(entry.value));
  const last = (kind: ReplayPerformanceKind) => of(kind).toSorted((a, b) => a.at - b.at).at(-1)?.value;
  const most = (kind: ReplayPerformanceKind) => {
    const values = of(kind).map((entry) => entry.value);
    return values.length ? Math.max(...values) : undefined;
  };
  return {
    fcp: of('first-contentful-paint')[0]?.value,
    lcp: last('largest-contentful-paint'),
    'long-task': most('long-task'),
    interaction: most('slow-interaction'),
  };
}

/** Below this the difference is noise in a single capture, not a regression or a win. */
export const SAME_WITHIN_MS = 20;

export type DeltaTone = 'slower' | 'faster' | 'same';

/** `value` against the baseline (the focused recording); undefined when either side was not captured. */
export function metricDelta(value: number | undefined, baseline: number | undefined) {
  if (value === undefined || baseline === undefined) return undefined;
  const difference = value - baseline;
  const tone: DeltaTone = Math.abs(difference) < SAME_WITHIN_MS ? 'same' : difference > 0 ? 'slower' : 'faster';
  return { difference, tone };
}

export function metricLabel(ms: number) {
  const value = Math.abs(ms);
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

/** "+1.20 s", "−48 ms", "Same": the sign says which way, the tone says whether that is worse. */
export function deltaLabel(delta: NonNullable<ReturnType<typeof metricDelta>>) {
  if (delta.tone === 'same') return 'Same';
  return `${delta.difference > 0 ? '+' : '−'}${metricLabel(delta.difference)}`;
}
