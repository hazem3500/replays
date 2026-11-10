import type { ReplayPerformanceTrack } from './replay.ts';

/** One recorded second of foreground animation cadence (`performance.frames`); `at` is on the replay's clock. */
export type FrameSample = NonNullable<ReplayPerformanceTrack['frames']>[number];

export type FrameVerdict = 'good' | 'needs-work' | 'poor';

/** At or above is smooth, at or above `NEEDS_WORK_FPS` is noticeable, below it is poor. Against a 60 Hz reference. */
const SMOOTH_FPS = 50;
const NEEDS_WORK_FPS = 30;

export function sampleFps(sample: Pick<FrameSample, 'frames' | 'elapsed'>) {
  return (sample.frames * 1000) / sample.elapsed;
}

export function fpsVerdict(fps: number): FrameVerdict {
  if (fps >= SMOOTH_FPS) return 'good';
  return fps >= NEEDS_WORK_FPS ? 'needs-work' : 'poor';
}

/** Missed frames as a share of the 60 Hz frames a recording of this length would show: up to 5 % good, 15 % noticeable. */
export function droppedVerdict(dropped: number, seconds: number): FrameVerdict {
  const share = dropped / Math.max(1, seconds * 60);
  if (share <= 0.05) return 'good';
  return share <= 0.15 ? 'needs-work' : 'poor';
}

interface FrameSummary {
  /** Median of the per-second frame rates. */
  p50: number;
  /** The slowest second. */
  min: number;
  /** Frames missed against a 60 Hz reference, summed; an estimate. */
  dropped: number;
  seconds: number;
}

export function summarizeFrames(samples: readonly FrameSample[] | undefined): FrameSummary | undefined {
  if (!samples?.length) return undefined;
  const rates = samples.map(sampleFps).toSorted((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const p50 = rates.length % 2 ? (rates[middle] ?? 0) : ((rates[middle - 1] ?? 0) + (rates[middle] ?? 0)) / 2;
  return {
    p50,
    min: rates[0] ?? 0,
    dropped: samples.reduce((sum, sample) => sum + sample.dropped, 0),
    seconds: samples.length,
  };
}

/** The few numbers a list row compares runs by; absent fields were not recorded. */
export interface ReplayPerfSummary {
  fpsP50?: number;
  fpsMin?: number;
  /** The longest long task, ms. */
  longestTask?: number;
  /** Blocking time: what long tasks spent past 50 ms, summed. */
  blocking?: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The list summary of a recording's performance track, from what was captured; undefined when nothing was. */
export function summarizePerformanceTrack(track: ReplayPerformanceTrack | undefined): ReplayPerfSummary | undefined {
  if (!track) return undefined;
  const frames = summarizeFrames(track.frames);
  const tasks = track.entries.filter((entry) => entry.kind === 'long-task' && Number.isFinite(entry.value) && entry.value >= 0);
  const longest = tasks.reduce((most, entry) => Math.max(most, entry.value), 0);
  const watched = track.supported.includes('longtask') || tasks.length > 0;
  const blocking = tasks.reduce((sum, entry) => sum + Math.max(0, entry.value - 50), 0);
  const summary: ReplayPerfSummary = {
    ...(frames ? { fpsP50: round(frames.p50), fpsMin: round(frames.min) } : {}),
    ...(watched ? { longestTask: round(longest), blocking: round(blocking) } : {}),
  };
  return Object.keys(summary).length ? summary : undefined;
}
