import { droppedVerdict, fpsVerdict, summarizeFrames } from '../../../shared/frame-timing.ts';
import type { ReplayPerformanceTrack } from '../../../shared/replay.ts';
import { formatDuration } from '../network/model.ts';
import type { LayoutShift } from '../performance.ts';
import { BUDGETS, type Budget, type Verdict, type Vital, type VitalId } from './model.ts';

export type StatGroup = 'loading' | 'responsiveness' | 'smoothness';

export const GROUP_LABELS: Readonly<Record<StatGroup, string>> = {
  loading: 'Loading',
  responsiveness: 'Responsiveness',
  smoothness: 'Smoothness',
};

/** The threshold meter's three bands as shares of its track, in track order, plus where the value sits (0 to 1). */
export interface Meter {
  bands: readonly { verdict: Verdict; share: number }[];
  at: number;
}

export interface Stat {
  id: string;
  group: StatGroup;
  label: string;
  /** The number, and its smaller unit. Absent when the stat has no value. */
  value?: string | undefined;
  unit?: string | undefined;
  verdict?: Verdict | undefined;
  meter?: Meter | undefined;
  hint: string;
  /** Why there is no value, for the group's tooltip. */
  missing?: string | undefined;
  /** The browser watched for it and nothing was reported, as opposed to not being able to measure it. */
  watched?: boolean | undefined;
  /** The quiet sentence for a watched stat that has no value, shown when the rest of its group does. */
  absent?: string | undefined;
}

/** A group with no measured stat is one muted line in its place: what is absent, and why when that is known. */
export interface GroupNote {
  text: string;
  reason?: string | undefined;
}

const NOT_RECORDED: Readonly<Record<StatGroup, string>> = {
  loading: 'Paint timing wasn’t recorded',
  responsiveness: 'Interactions and long tasks weren’t recorded',
  smoothness: 'Frame rate wasn’t recorded',
};

const NOTHING_REPORTED: Readonly<Record<StatGroup, string>> = {
  loading: 'Recording started after the page loaded',
  responsiveness: 'No slow interactions or long tasks were reported',
  smoothness: 'No frame samples were reported',
};

const DEFAULT_REASON: Readonly<Record<StatGroup, string>> = {
  loading: 'This browser did not report paint timing.',
  responsiveness: 'This browser did not report long tasks or interactions.',
  smoothness: 'Frame timing was not recorded.',
};

/** The line standing in for a group whose stats are all missing; `missing` holds the group's stats that have no value. */
export function groupNote(group: StatGroup, missing: readonly Stat[]): GroupNote {
  if (missing.length && missing.every((stat) => stat.watched)) return { text: NOTHING_REPORTED[group] };
  return { text: NOT_RECORDED[group], reason: missing.find((stat) => stat.missing)?.missing ?? DEFAULT_REASON[group] };
}

/** The longest track a budget's meter draws, as a multiple of its poor line, so a value just past it still has room. */
const TRACK_SPAN = 1.6;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Lower is better: good up to `good`, poor past `poor`, the track running to `top`. */
function risingMeter(value: number, good: number, poor: number, top: number): Meter {
  return {
    bands: [
      { verdict: 'good', share: good / top },
      { verdict: 'needs-work', share: (poor - good) / top },
      { verdict: 'poor', share: (top - poor) / top },
    ],
    at: clamp(value / top),
  };
}

/** Higher is better: poor below `poor`, good from `good`, the track running to `top`. */
function fallingMeter(value: number, poor: number, good: number, top: number): Meter {
  return {
    bands: [
      { verdict: 'poor', share: poor / top },
      { verdict: 'needs-work', share: (good - poor) / top },
      { verdict: 'good', share: (top - good) / top },
    ],
    at: clamp(value / top),
  };
}

/** "1.90 s" as `['1.90', 's']`. */
export function splitDuration(milliseconds: number): [string, string] {
  const [value = '', unit = ''] = formatDuration(milliseconds).split(' ');
  return [value, unit];
}

const VITAL_META: Readonly<Record<VitalId, { group: StatGroup; label: string; hint: string }>> = {
  fcp: {
    group: 'loading',
    label: 'First paint',
    hint: 'First contentful paint: when anything first appeared. Good under 1.8 s, poor over 3 s.',
  },
  lcp: {
    group: 'loading',
    label: 'Largest paint',
    hint: 'Largest contentful paint: the latest candidate the browser reported. Good under 2.5 s, poor over 4 s.',
  },
  interaction: {
    group: 'responsiveness',
    label: 'Slowest interaction',
    hint: 'The slowest response to a click, key or input. Good under 200 ms, poor over 500 ms.',
  },
  task: {
    group: 'responsiveness',
    label: 'Longest task',
    hint: 'The longest stretch the main thread could not respond. Good under 100 ms, poor over 250 ms.',
  },
  tbt: {
    group: 'responsiveness',
    label: 'Blocking time',
    hint: 'Every long task’s time past 50 ms, summed. Good under 200 ms, poor over 600 ms.',
  },
};

const VITAL_ABSENT: Readonly<Record<VitalId, string>> = {
  fcp: 'Recording started after the first paint',
  lcp: 'Recording started after the largest paint',
  interaction: 'No interaction was slow enough to report',
  task: 'No long tasks were reported',
  tbt: 'No long tasks were reported',
};

const VITAL_MISSING = {
  'not-captured': 'Not captured: this browser did not report it.',
  none: 'Watched, and nothing was reported.',
} as const;

export function vitalStat(vital: Vital): Stat {
  const { group, label, hint } = VITAL_META[vital.id];
  if (vital.value === undefined || !vital.verdict)
    return {
      id: vital.id,
      group,
      label,
      hint,
      missing: VITAL_MISSING[vital.missing ?? 'not-captured'],
      watched: vital.missing === 'none',
      absent: VITAL_ABSENT[vital.id],
    };
  const [good, poor]: Budget = BUDGETS[vital.id];
  const [value, unit] = splitDuration(vital.value);
  return {
    id: vital.id,
    group,
    label,
    hint,
    value,
    unit,
    verdict: vital.verdict,
    meter: risingMeter(vital.value, good, poor, poor * TRACK_SPAN),
  };
}

/** Layout shift score: good to 0.1, poor over 0.25 (Web Vitals CLS). */
export const SHIFT_BUDGET: Budget = [0.1, 0.25];

export function shiftVerdict(score: number): Verdict {
  if (score <= SHIFT_BUDGET[0]) return 'good';
  return score <= SHIFT_BUDGET[1] ? 'needs-work' : 'poor';
}

/** The score counts shifts nobody caused; one that followed an input is expected and excluded. */
export function shiftScore(shifts: readonly LayoutShift[]) {
  return shifts.filter((shift) => !shift.hadRecentInput).reduce((sum, shift) => sum + shift.value, 0);
}

const FPS_TRACK = 60;
const DROPPED_TRACK = 0.25;

const STRINGS = {
  median: 'Median frame rate',
  slowest: 'Slowest second',
  dropped: 'Dropped frames',
  shift: 'Layout shift',
  droppedHint: 'Estimated against a 60 Hz display, summed over the recording. Good up to 5 % of frames, poor over 15 %.',
  medianHint: 'The middle second’s frame rate while the tab was in front. Good from 50 fps, poor under 30.',
  slowestHint: 'The slowest second’s frame rate. Good from 50 fps, poor under 30.',
  shiftHint: 'Layout shift score: the sum of shifts nobody caused. Good to 0.1, poor over 0.25.',
  none: 'Frame timing was not recorded.',
  noSamples: 'No foreground frame samples were captured.',
  shiftsUnavailable: 'Layout shift: not available in this browser.',
};

/** The smoothness group: frame rate and dropped frames from the cadence samples, then the layout shift score. */
export function cadenceStats(track: ReplayPerformanceTrack | undefined, shifts: readonly LayoutShift[]): Stat[] {
  if (!track) return [];
  const summary = summarizeFrames(track.frames);
  const missing = track.supported.includes('animation-frame') ? STRINGS.noSamples : STRINGS.none;
  const group = 'smoothness';
  const fps = (id: string, label: string, hint: string, rate: number | undefined): Stat => {
    if (rate === undefined) return { id, group, label, hint, missing };
    return {
      id,
      group,
      label,
      hint,
      value: String(Math.round(rate)),
      unit: 'fps',
      verdict: fpsVerdict(rate),
      meter: fallingMeter(rate, 30, 50, Math.max(FPS_TRACK, rate)),
    };
  };
  const dropped: Stat = summary
    ? {
        id: 'dropped',
        group,
        label: STRINGS.dropped,
        hint: STRINGS.droppedHint,
        value: `~${summary.dropped}`,
        verdict: droppedVerdict(summary.dropped, summary.seconds),
        meter: risingMeter(summary.dropped / Math.max(1, summary.seconds * 60), 0.05, 0.15, DROPPED_TRACK),
      }
    : { id: 'dropped', group, label: STRINGS.dropped, hint: STRINGS.droppedHint, missing };
  const [good, poor] = SHIFT_BUDGET;
  const watched = track.supported.includes('layout-shift');
  const score = shiftScore(shifts);
  const shift: Stat = watched
    ? {
        id: 'shift',
        group,
        label: STRINGS.shift,
        hint: STRINGS.shiftHint,
        value: score.toFixed(2),
        verdict: shiftVerdict(score),
        meter: risingMeter(score, good, poor, 0.4),
      }
    : { id: 'shift', group, label: STRINGS.shift, hint: STRINGS.shiftHint, missing: STRINGS.shiftsUnavailable };
  return [
    fps('median', STRINGS.median, STRINGS.medianHint, summary?.p50),
    fps('slowest', STRINGS.slowest, STRINGS.slowestHint, summary?.min),
    dropped,
    shift,
  ];
}
