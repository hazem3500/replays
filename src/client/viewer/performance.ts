import type { EditTimeline } from '../../shared/edits.ts';
import type { ReplayBundle, ReplayPerformanceKind } from '../../shared/replay.ts';
import { type FrameBand, frameBands } from './performance/frames.ts';
import type { PerfWhy } from './performance/why.ts';
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
  /** Layout shifts on the player's clock (after edits); empty when none were captured or the browser could not observe them. */
  shifts: LayoutShift[];
  /** Long animation frames and interactions with their breakdown (Performance mode), on the player's clock. */
  why: PerfWhy;
}

/** One layout shift: its score (`value`) and whether it followed an input, which the layout shift score excludes. */
export interface LayoutShift {
  at: number;
  value: number;
  hadRecentInput: boolean;
}

function layoutShifts(shifts: ReplayBundle['performance'], timeline?: EditTimeline): LayoutShift[] {
  return (shifts?.layoutShifts ?? []).flatMap((shift) => {
    if (timeline && (timeline.isRemoved(shift.at) || shift.at > timeline.originalDuration)) return [];
    return [{ at: timeline ? timeline.toEdited(shift.at) : shift.at, value: shift.value, hadRecentInput: shift.hadRecentInput }];
  });
}

function whyOf(track: ReplayBundle['performance'], timeline?: EditTimeline): PerfWhy {
  const visible = (at: number) => !timeline || (!timeline.isRemoved(at) && at <= timeline.originalDuration);
  const mapped = (at: number) => (timeline ? timeline.toEdited(at) : at);
  return {
    frames: (track?.longFrames ?? []).flatMap((frame, index) => (visible(frame.at) ? [{ ...frame, at: mapped(frame.at), index }] : [])),
    interactions: track?.interactions?.flatMap((item) => (visible(item.at) ? [{ ...item, at: mapped(item.at) }] : [])),
  };
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
  const frames = frameBands(bundle.performance?.frames, timeline);
  return {
    ...model,
    signals,
    moments,
    longestTask,
    slowestInteraction,
    largestPaint,
    track: bundle.performance,
    frames,
    shifts: layoutShifts(bundle.performance, timeline),
    why: whyOf(bundle.performance, timeline),
  };
}

export function missingPerformanceLabel(model: PerformanceModel, api: string, kind: ReplayPerformanceKind) {
  if (!model.track) return 'Not recorded';
  if (model.signals.some((row) => row.entry.kind === kind)) return 'Invalid / unknown';
  if (model.track.entries.some((entry) => entry.kind === kind)) return 'Not on this timeline';
  if (!model.track.supported.includes(api)) return 'API unavailable';
  return 'None captured';
}
