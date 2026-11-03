import { bundleSpan, editTimeline, type EditTimeline } from '../../shared/edits.ts';
import {
  hasNoResponse,
  isFailedRequest,
  type ReplayBundle,
  type ReplayNetworkEntry,
  type ReplayPerformanceEntry,
  type ReplayStep,
} from '../../shared/replay.ts';

export interface WaterfallSegment {
  from: number;
  to: number;
}
/** Captured and visible timing shared by portable network, step and performance rows. */
export interface RowTiming {
  id: string;
  label: string;
  /** First visible instant, in the player's clock. */
  at: number;
  sourceAt: number;
  segments: WaterfallSegment[];
  /** Measured source duration, never relabelled as edited elapsed time. */
  measured?: number;
  visible?: number;
  timing: 'measured' | 'point' | 'incomplete' | 'invalid';
  failed: boolean;
  slow: boolean;
}
export type WaterfallRow = RowTiming &
  (
    | { kind: 'network'; entry: ReplayNetworkEntry }
    | { kind: 'action'; entry: ReplayStep }
    | { kind: 'performance'; entry: ReplayPerformanceEntry }
  );

export function performanceLabel(kind: ReplayPerformanceEntry['kind']) {
  switch (kind) {
    case 'first-contentful-paint':
      return 'First contentful paint';
    case 'largest-contentful-paint':
      return 'Largest contentful paint candidate';
    case 'long-task':
      return 'Main-thread task';
    case 'slow-interaction':
      return 'Slow interaction';
  }
}

export function performanceHasDuration(kind: ReplayPerformanceEntry['kind']) {
  return kind === 'long-task' || kind === 'slow-interaction';
}

export function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Intersect a measured source span with kept time, then map both ends (including speed-ups).
 * Splits at cuts: adjacent edited pieces still retain their separate source provenance.
 */
export function visibleSegments(at: number, duration: number, timeline: EditTimeline): WaterfallSegment[] {
  if (!Number.isFinite(at) || at < 0 || !validDuration(duration) || !Number.isFinite(at + duration)) return [];
  const end = Math.min(at + duration, timeline.originalDuration);
  if (at >= end) return [];
  const segments: WaterfallSegment[] = [];
  let cursor = at;
  const keep = (from: number, to: number) => {
    if (to > from) segments.push({ from: timeline.toEdited(from), to: timeline.toEdited(to) });
  };
  for (const removed of timeline.removed) {
    if (removed.to <= cursor) continue;
    if (removed.from >= end) break;
    keep(cursor, Math.min(end, removed.from));
    cursor = Math.max(cursor, removed.to);
    if (cursor >= end) break;
  }
  keep(cursor, end);
  return segments;
}

export function buildWaterfall(bundle: ReplayBundle, timeline = editTimeline(undefined, bundleSpan(bundle))) {
  const rows: WaterfallRow[] = [];
  let invalidTimes = 0;
  const timing = (
    at: number,
    measured: unknown,
    mode: RowTiming['timing'],
  ): Omit<RowTiming, 'id' | 'label' | 'failed' | 'slow'> | undefined => {
    if (!Number.isFinite(at) || at < 0) {
      invalidTimes++;
      return;
    }
    const duration = mode === 'measured' && validDuration(measured) && Number.isFinite(at + measured) ? measured : undefined;
    const state = mode === 'measured' && duration === undefined ? 'invalid' : mode;
    const segments = duration !== undefined && duration > 0 ? visibleSegments(at, duration, timeline) : [];
    if (duration !== undefined && duration > 0) {
      if (!segments.length) return;
    } else if (at > timeline.originalDuration || timeline.isRemoved(at)) return;
    return {
      at: segments[0]?.from ?? timeline.toEdited(at),
      sourceAt: at,
      segments,
      timing: state,
      ...(duration !== undefined ? { measured: duration, visible: segments.reduce((sum, span) => sum + span.to - span.from, 0) } : {}),
    };
  };
  bundle.network.forEach((entry, index) => {
    const time = timing(entry.at, entry.duration, hasNoResponse(entry) ? 'incomplete' : 'measured');
    if (time)
      rows.push({
        ...time,
        id: `network-${index}`,
        kind: 'network',
        entry,
        label: `${entry.method} ${entry.url}`,
        failed: isFailedRequest(entry),
        slow: (time.measured ?? 0) >= 500,
      });
  });
  bundle.steps.forEach((entry, index) => {
    const time = timing(entry.at, undefined, 'point');
    if (time)
      rows.push({
        ...time,
        id: `action-${index}`,
        kind: 'action',
        entry,
        label: `${entry.kind}: ${entry.label}`,
        failed: false,
        slow: false,
      });
  });
  bundle.performance?.entries.forEach((entry, index) => {
    const span = performanceHasDuration(entry.kind);
    const time = timing(entry.at, entry.value, span ? 'measured' : 'point');
    if (time)
      rows.push({
        ...time,
        id: `performance-${index}`,
        kind: 'performance',
        entry,
        label: performanceLabel(entry.kind),
        failed: false,
        slow: false,
      });
  });
  rows.sort((a, b) => a.at - b.at || a.sourceAt - b.sourceAt || a.id.localeCompare(b.id));
  return { rows, invalidTimes };
}
