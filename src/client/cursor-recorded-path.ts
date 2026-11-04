import type { ReplaySource } from '../shared/replay.ts';

/** The minimum pointer positions a recording needs before density alone can call it a person's. */
const MIN_HUMAN_SAMPLES = 60;
/** Two positions this close in time belong to one continuous stroke (the recorder samples motion every ~50 ms). */
const STROKE_GAP_MS = 100;
/** A person's pointer is almost always mid-stroke; an agent's mostly jumps from spot to spot. */
const MIN_STROKE_SHARE = 0.7;
/** Where a person's pointer sat still before a sample, the cursor rides only the last stretch into it: one sampling interval. */
const SETTLE_INTO_SAMPLE_MS = 50;

/**
 * Whether the cursor should ride the recorded path exactly. The bundle's own
 * `meta.source` decides when it says: the browser recorder and rrweb imports are
 * `human`, the capture CLI is `agent`. A bundle that does not say (older producers)
 * is a person's when its pointer stream is dense: at least 60 positions, 70% of
 * them within 100 ms of the one before. Agents' streams are sparse jumps or a few
 * short sweeps, so they stay on the glide.
 */
export function followsRecordedPath(source: ReplaySource | undefined, points: ReadonlyArray<{ t: number }>) {
  if (source) return source === 'human';
  if (points.length < MIN_HUMAN_SAMPLES) return false;
  let strokes = 0;
  let previous: number | undefined;
  for (const { t } of points) {
    if (previous !== undefined && t - previous <= STROKE_GAP_MS) strokes++;
    previous = t;
  }
  return strokes / (points.length - 1) >= MIN_STROKE_SHARE;
}

/** One straight stretch of the recorded path: `[0, x0, y0, heading, durationMs, x1, y1, heading]`. */
export interface RecordedSegment {
  start: number;
  durationMs: number;
  samples: Float64Array;
}

/**
 * The recorded pointer path as straight segments between consecutive positions, on
 * their own timestamps: no arc, no easing. Where the pointer sat still for `restMs`
 * or more between two positions, the cursor holds and only the last
 * `SETTLE_INTO_SAMPLE_MS` is spent moving into the next one, so it leaves when the
 * pointer did rather than creeping across the whole still. Positions that repeat a
 * timestamp keep the last; a segment that goes nowhere is dropped.
 */
export function recordedSegments(points: ReadonlyArray<{ t: number; x: number; y: number }>, heading: number, restMs: number) {
  const path: Array<{ t: number; x: number; y: number }> = [];
  for (const point of points) {
    if (path.at(-1)?.t === point.t) path.pop();
    path.push(point);
  }
  const segments: RecordedSegment[] = [];
  let from = path[0];
  for (const to of path.slice(1)) {
    const origin = from;
    from = to;
    if (!origin || (origin.x === to.x && origin.y === to.y)) continue;
    const start = to.t - origin.t >= restMs ? to.t - SETTLE_INTO_SAMPLE_MS : origin.t;
    const durationMs = to.t - start;
    segments.push({ start, durationMs, samples: Float64Array.of(0, origin.x, origin.y, heading, durationMs, to.x, to.y, heading) });
  }
  return segments;
}
