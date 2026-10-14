import { formatClock } from '../../shared/replay.ts';
import { clusterMarkers } from '../timeline.ts';

/** Step boundaries (and error dots) drawn closer than this many pixels merge into one mark. */
export const MARKER_GAP = 8;

export type MarkKind = 'step' | 'error';

/** Something on the track a hover can name: a step boundary or an error dot (or a merged run of them). */
export interface ScrubberMark {
  kind: MarkKind;
  /** Track pixels from the start of the track. */
  x: number;
  /** Time of the mark (the earliest member when merged). */
  at: number;
  /** What the time bubble says after the time, e.g. "Start the timer" or "Click Save +2 more". */
  label: string;
}

/** "First label" or "First label +N more" for a merged run; the bubble has room for one line. */
export function runLabel(labels: readonly string[]) {
  const [first = '', ...rest] = labels;
  return rest.length === 0 ? first : `${first} +${rest.length} more`;
}

/** The bubble text: "0:05.6" while scrubbing, "0:05.6 · Start the timer" over a mark. */
export function bubbleText(time: number, label?: string) {
  return label ? `${formatClock(time)} · ${label}` : formatClock(time);
}

/**
 * Step boundaries and error clusters in track pixels, each merged when closer than `gap`. Inputs are
 * sorted by time already (ReplayStep / ReplayError are); steps come first, so a step wins a tie.
 */
export function scrubberMarks(
  steps: ReadonlyArray<{ at: number; label: string }>,
  errors: ReadonlyArray<{ at: number; label: string }>,
  duration: number,
  width: number,
  gap = MARKER_GAP,
): ScrubberMark[] {
  if (width <= 0 || duration <= 0) return [];
  const px = (at: number) => (Math.min(duration, Math.max(0, at)) / duration) * width;
  const build = (kind: MarkKind, entries: ReadonlyArray<{ at: number; label: string }>) =>
    clusterMarkers(
      entries.map((entry) => entry.at),
      duration,
      width,
      gap,
    ).map(({ at, indices }) => {
      const first = entries[indices[0]!]!.label;
      // Merged errors are one dot; the bubble gives the count.
      const label =
        kind === 'error' && indices.length > 1
          ? `${indices.length} errors · ${first}`
          : runLabel(indices.map((index) => entries[index]!.label));
      return { kind, x: px(at), at, label };
    });
  return [...build('step', steps), ...build('error', errors)];
}

/** Index of the mark nearest `x` within `tolerance` pixels, or -1. */
export function nearestMark(marks: readonly ScrubberMark[], x: number, tolerance: number) {
  let nearest = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, mark] of marks.entries()) {
    const gap = Math.abs(mark.x - x);
    // Strictly closer only: on a tie the earlier mark (a step before an error) keeps it.
    if (gap <= tolerance && gap < distance) {
      distance = gap;
      nearest = index;
    }
  }
  return nearest;
}

/** Keeps a bubble `size` wide centred on `x` inside [0, bound]. */
export function clampCentre(x: number, size: number, bound: number) {
  const half = size / 2;
  if (bound <= size) return bound / 2;
  return Math.min(bound - half, Math.max(half, x));
}

/** Index of the step x (track px) nearest `x` within `tolerance`, or -1: the drag's magnetic snap. */
export function snapIndex(stepXs: readonly number[], x: number, tolerance: number) {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, stepX] of stepXs.entries()) {
    const gap = Math.abs(stepX - x);
    if (gap <= tolerance && gap < distance) {
      distance = gap;
      best = index;
    }
  }
  return best;
}

/** A strong ease-out (≈ cubic-bezier(0.23, 1, 0.32, 1)) for the seek glide, on 0–1. */
export function easeOut(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 4;
}

/** Bars that would show narrower than this (px, after the gap) merge with their neighbour: no slivers. */
export const MIN_SEGMENT_PX = 8;
/** Space between two bars (px). */
export const SEGMENT_GAP = 3;
/** Above this many bars the steps merge evenly, so the gaps stay calm. */
export const MAX_SEGMENTS = 40;

/** One rounded bar of the scrubber: a step's span (or a merged run of steps), in ms. */
export interface ScrubberSegment {
  start: number;
  end: number;
  /** First and last step in the bar (both -1 for a replay without steps). */
  first: number;
  last: number;
  /** What the bubble names after hover intent: "Type the email" or "Type the email +2 more". */
  label: string;
}

/**
 * The scrubber's bars: one per step span (the first from 0, the last to the end), merging spans that would
 * show narrower than `minPx` once `gap` is taken out into their neighbour and, past `max` bars, merging
 * evenly. `steps` are time-ascending.
 */
export function scrubberSegments(
  steps: ReadonlyArray<{ at: number; label: string }>,
  duration: number,
  width: number,
  minPx = MIN_SEGMENT_PX,
  max = MAX_SEGMENTS,
  gap = SEGMENT_GAP,
): ScrubberSegment[] {
  if (duration <= 0) return [];
  if (steps.length === 0) return [{ start: 0, end: duration, first: -1, last: -1, label: '' }];
  const pxPerMs = width > 0 ? width / duration : 0;
  const narrow = (segment: { start: number; end: number }) => pxPerMs > 0 && (segment.end - segment.start) * pxPerMs - gap < minPx;
  const spans = steps.map((step, index) => ({
    start: index === 0 ? 0 : Math.min(duration, Math.max(0, step.at)),
    end: index + 1 < steps.length ? Math.min(duration, Math.max(0, steps[index + 1]!.at)) : duration,
    first: index,
    last: index,
  }));
  let merged: typeof spans = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && (narrow(span) || narrow(previous))) {
      previous.end = span.end;
      previous.last = span.last;
    } else {
      merged.push({ ...span });
    }
  }
  if (merged.length > max) {
    const size = Math.ceil(merged.length / max);
    const grouped: typeof spans = [];
    for (let index = 0; index < merged.length; index += size) {
      const group = merged.slice(index, index + size);
      grouped.push({ start: group[0]!.start, end: group.at(-1)!.end, first: group[0]!.first, last: group.at(-1)!.last });
    }
    merged = grouped;
  }
  return merged.map((span) => ({
    ...span,
    label: runLabel(steps.slice(span.first, span.last + 1).map((step) => step.label)),
  }));
}

/** Index of the bar holding `time` (the last bar at the end), or -1 without bars. */
export function segmentAt(segments: readonly ScrubberSegment[], time: number) {
  if (segments.length === 0) return -1;
  for (const [index, segment] of segments.entries()) if (time < segment.end) return index;
  return segments.length - 1;
}

/** How full each bar is at `time`, 0–1: past bars full, the current one partly, future ones empty. */
export function segmentFill(segment: ScrubberSegment, time: number) {
  if (time >= segment.end) return 1;
  if (time <= segment.start) return 0;
  return (time - segment.start) / (segment.end - segment.start);
}

/** Errors closer than this (px) share one notch on the bars. */
export const ERROR_NOTCH_GAP = 4;

/** A bar's box on the track (px): flush at the ends, half a gap shy of each inner boundary. */
export function barBox(segment: ScrubberSegment, index: number, count: number, duration: number, width: number, gap = SEGMENT_GAP) {
  const from = (segment.start / duration) * width + (index === 0 ? 0 : gap / 2);
  const to = (segment.end / duration) * width - (index === count - 1 ? 0 : gap / 2);
  return { left: from, width: Math.max(0, to - from) };
}

/**
 * Where an error notch `half` px wide each side of its centre sits: at `x` when that is on a bar (kept
 * clear of the rounded caps by `cap`), otherwise on the nearest bar's edge, never in a gap.
 */
export function notchX(x: number, boxes: ReadonlyArray<{ left: number; width: number }>, cap = 2) {
  let best = x;
  let distance = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    const low = box.left + Math.min(cap, box.width / 2);
    const high = box.left + box.width - Math.min(cap, box.width / 2);
    const placed = Math.min(high, Math.max(low, x));
    const gap = Math.abs(placed - x);
    if (gap < distance) {
      distance = gap;
      best = placed;
    }
  }
  return best;
}
