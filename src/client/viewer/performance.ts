import type { EditTimeline } from '../../shared/edits.ts';
import type { ReplayBundle, ReplayPerformanceKind } from '../../shared/replay.ts';
import { type FrameBand, frameBands } from './performance/frames.ts';
import { buildWaterfall, performanceHasDuration, validDuration, type WaterfallRow } from './waterfall.ts';

export type PerformanceSignal = Extract<WaterfallRow, { kind: 'performance' }>;

/** Public diagnostic model on the playback timeline; captured metric values retain their original meaning. */
export interface PerformanceModel {
  rows: WaterfallRow[];
  invalidTimes: number;
  signals: PerformanceSignal[];
  moments: PerformanceSignal[];
  longestTask: PerformanceSignal | undefined;
  slowestInteraction: PerformanceSignal | undefined;
  largestPaint: PerformanceSignal | undefined;
  track: ReplayBundle['performance'];
  /** Foreground frame rate per second of recording, on the player's clock; empty when frame timing was not recorded. */
  frames: FrameBand[];
}

/** Reuse the source → edited span mapping; metric values always retain their captured meaning. */
export function buildPerformance(bundle: ReplayBundle, timeline?: EditTimeline): PerformanceModel {
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
  return { ...model, signals, moments, longestTask, slowestInteraction, largestPaint, track: bundle.performance, frames: frameBands(bundle.performance?.frames, timeline) };
}

export function missingPerformanceLabel(model: PerformanceModel, api: string, kind: ReplayPerformanceKind) {
  if (!model.track) return 'Not recorded';
  if (model.signals.some((row) => row.entry.kind === kind)) return 'Invalid / unknown';
  if (model.track.entries.some((entry) => entry.kind === kind)) return 'Not on this timeline';
  if (!model.track.supported.includes(api)) return 'API unavailable';
  return 'None captured';
}
