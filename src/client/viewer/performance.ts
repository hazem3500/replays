import type { EditTimeline } from '../../shared/edits.ts';
import type { ReplayBundle, ReplayPerformanceKind } from '../../shared/replay.ts';
import { buildWaterfall, performanceHasDuration, validDuration, type WaterfallRow } from './waterfall.ts';

export type PerformanceSignal = Extract<WaterfallRow, { kind: 'performance' }>;
export type PerformanceLane = 'tasks' | 'interactions' | 'network' | 'paint';
export const PERFORMANCE_LANES: readonly { id: PerformanceLane; label: string }[] = [
  { id: 'tasks', label: 'Main thread' },
  { id: 'interactions', label: 'Interactions' },
  { id: 'network', label: 'Network' },
  { id: 'paint', label: 'Paint' },
];

/** Reuse the source → edited span mapping; metric values always retain their captured meaning. */
export function buildPerformance(bundle: ReplayBundle, timeline?: EditTimeline) {
  const model = buildWaterfall(bundle, timeline);
  const signals = model.rows.filter((row): row is PerformanceSignal => row.kind === 'performance');
  const moments = signals
    .filter((row) => performanceHasDuration(row.entry.kind) && row.measured !== undefined)
    .toSorted((a, b) => b.measured! - a.measured! || a.at - b.at || a.id.localeCompare(b.id));
  const longestTask = moments.find((row) => row.entry.kind === 'long-task');
  const slowestInteraction = moments.find((row) => row.entry.kind === 'slow-interaction');
  // This is the latest captured candidate still visible after edits, not a final Web Vitals score.
  const largestPaint = signals
    .filter((row) => row.entry.kind === 'largest-contentful-paint' && validDuration(row.entry.value))
    .reduce<PerformanceSignal | undefined>((latest, row) => (!latest || row.sourceAt >= latest.sourceAt ? row : latest), undefined);
  return { ...model, signals, moments, longestTask, slowestInteraction, largestPaint, track: bundle.performance };
}

export type PerformanceModel = ReturnType<typeof buildPerformance>;

/** One lane control avoids overlapping small targets; empty lane space selects the nearest visible event. */
export function nearestPerformanceRow(rows: readonly WaterfallRow[], at: number) {
  const distance = (row: WaterfallRow) =>
    row.segments.length
      ? row.segments.reduce((nearest, span) => Math.min(nearest, Math.max(span.from - at, at - span.to, 0)), Infinity)
      : Math.abs(row.at - at);
  return rows.reduce<WaterfallRow | undefined>((nearest, row) => {
    if (!nearest) return row;
    const delta = distance(row) - distance(nearest);
    return delta < 0 || (delta === 0 && Math.abs(row.at - at) < Math.abs(nearest.at - at)) ? row : nearest;
  }, undefined);
}

export function performanceLane(row: WaterfallRow): PerformanceLane | undefined {
  if (row.kind === 'network') return 'network';
  if (row.kind !== 'performance') return;
  return row.entry.kind === 'long-task' ? 'tasks' : row.entry.kind === 'slow-interaction' ? 'interactions' : 'paint';
}

const contains = (span: WaterfallRow, at: number) => span.segments.some((segment) => segment.from <= at && at < segment.to);

/** Positive overlap only: adjacent spans, including spans joined by a cut, are not concurrent. */
export function overlaps(a: WaterfallRow, b: WaterfallRow) {
  if (a.segments.length && b.segments.length)
    return a.segments.some((left) => b.segments.some((right) => left.from < right.to && right.from < left.to));
  if (a.segments.length) return contains(a, b.at);
  if (b.segments.length) return contains(b, a.at);
  return a.at === b.at;
}

export function relatedPerformanceActivity(selected: WaterfallRow, rows: readonly WaterfallRow[]) {
  const overlapping: WaterfallRow[] = [];
  const nearbyActions: WaterfallRow[] = [];
  for (const row of rows) {
    if (row.id === selected.id) continue;
    if (overlaps(selected, row)) overlapping.push(row);
    else if (row.kind === 'action' && Math.abs(row.sourceAt - selected.sourceAt) <= 500) nearbyActions.push(row);
  }
  return { overlapping, nearbyActions };
}

export interface PerformanceWindow {
  from: number;
  to: number;
}

/** Bound timeline DOM for large recordings; disclose exact omissions and always retain the selection. */
export function chartLaneRows(
  rows: readonly WaterfallRow[],
  lane: PerformanceLane,
  window: PerformanceWindow,
  selected?: string,
  limit = 160,
) {
  const visible = rows.filter(
    (row) =>
      performanceLane(row) === lane &&
      (row.segments.length
        ? row.segments.some((span) => span.from < window.to && span.to > window.from)
        : row.at >= window.from && row.at <= window.to),
  );
  const drawn = visible.slice(0, limit);
  const selection = visible.find((row) => row.id === selected);
  if (selection && !drawn.includes(selection) && drawn.length) drawn[drawn.length - 1] = selection;
  return { rows: drawn, omitted: Math.max(0, visible.length - drawn.length) };
}

export function focusPerformanceWindow(row: WaterfallRow, duration: number): PerformanceWindow {
  const end = row.segments.at(-1)?.to ?? row.at;
  return { from: Math.max(0, row.at - 1000), to: Math.min(duration, Math.max(row.at + 1000, end + 1000)) };
}

export function missingPerformanceLabel(model: PerformanceModel, api: string, kind: ReplayPerformanceKind) {
  if (!model.track) return 'Not recorded';
  if (model.signals.some((row) => row.entry.kind === kind)) return 'Invalid / unknown';
  if (model.track.entries.some((entry) => entry.kind === kind)) return 'Not on this timeline';
  if (!model.track.supported.includes(api)) return 'API unavailable';
  return 'None captured';
}
