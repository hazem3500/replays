import { formatClock } from '../shared/replay.ts';

export function clampTime(ms: number, duration: number) {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(Math.max(0, ms), duration);
}

/** "0:02.6 of 0:03.2" for the scrubber's aria-valuetext. */
export function positionText(ms: number, duration: number) {
  return `${formatClock(ms)} of ${formatClock(duration)}`;
}

/** Number of entries in `sortedAts` (ascending) that are at or before `time`. */
export function countAtOrBefore(sortedAts: readonly number[], time: number) {
  let low = 0;
  let high = sortedAts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sortedAts[middle]! <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Entries sorted by `at` (stable), plus the matching ascending time index. */
export function sortByAt<T extends { at: number }>(entries: readonly T[]) {
  const sorted = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index);
  return { entries: sorted.map(({ entry }) => entry), ats: sorted.map(({ entry }) => entry.at) };
}

export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/**
 * Scales a recorded viewport to fit inside `box` (minus `padding` on each
 * side) while preserving its aspect ratio, and centres it.
 */
export function fitViewport(box: { width: number; height: number }, viewport: { width: number; height: number }, padding = 0): Fit {
  const availableWidth = Math.max(0, box.width - padding * 2);
  const availableHeight = Math.max(0, box.height - padding * 2);
  if (viewport.width <= 0 || viewport.height <= 0 || availableWidth === 0 || availableHeight === 0) return { scale: 0, x: 0, y: 0 };
  const scale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height);
  return {
    scale,
    x: Math.round((box.width - viewport.width * scale) / 2),
    y: Math.round((box.height - viewport.height * scale) / 2),
  };
}

/** `[` within this long after a step starts goes to the step before it, like a media player's "previous". */
const STEP_EPSILON = 50;

/**
 * Index of the step after the playhead, or -1. `current` is the step the viewer last jumped to while the
 * playhead is still on it: agents log several steps within a few milliseconds (or the same one), so
 * stepping by time alone would skip them.
 */
export function nextStepIndex(steps: ReadonlyArray<{ at: number; folded?: true }>, time: number, current?: number) {
  if (current !== undefined && current >= 0 && current < steps.length) {
    const next = steps.findIndex((step, index) => index > current && !step.folded);
    return next;
  }
  return steps.findIndex((step) => step.at > time && !step.folded);
}

/** Index of the last step before `time` (the current step's start counts), or -1. `current` as in nextStepIndex. */
export function previousStepIndex(steps: ReadonlyArray<{ at: number; folded?: true }>, time: number, current?: number) {
  if (current !== undefined && current >= 0 && current < steps.length)
    return steps.findLastIndex((step, index) => index < current && !step.folded);
  return steps.findLastIndex((step) => step.at < time - STEP_EPSILON && !step.folded);
}

export interface MarkerCluster {
  /** Seek target and drawn position: the earliest member. */
  at: number;
  /** Indices into the input array, ascending by time. */
  indices: number[];
}

/**
 * Groups time-sorted markers that would be drawn closer than `minGap` pixels on
 * a track `width` pixels wide, so clustered ticks merge into one with a count.
 */
export function clusterMarkers(ats: readonly number[], duration: number, width: number, minGap: number): MarkerCluster[] {
  const clusters: MarkerCluster[] = [];
  const pxPerMs = duration > 0 && width > 0 ? width / duration : 0;
  for (const [index, at] of ats.entries()) {
    const last = clusters.at(-1);
    if (last && pxPerMs > 0 && (at - last.at) * pxPerMs < minGap) last.indices.push(index);
    else clusters.push({ at, indices: [index] });
  }
  return clusters;
}

/**
 * The step on screen at `time`. Pass the replay `duration`: at the end every step counts as reached,
 * because an agent's last step can be logged a few milliseconds after the last DOM event.
 */
export function activeStepIndex(steps: ReadonlyArray<{ at: number; folded?: true }>, time: number, duration = Number.POSITIVE_INFINITY) {
  const horizon = time >= duration ? Number.POSITIVE_INFINITY : time;
  return steps.length === 0
    ? -1
    : Math.max(
        0,
        steps.findLastIndex((step) => step.at <= horizon && !step.folded),
      );
}
