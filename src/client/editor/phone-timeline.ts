import type { ReplayStep } from '../../shared/replay.ts';
import type { TimelineScale } from './timeline-drag.ts';
import { wordsThatFit } from './block-label.ts';
import { segmentAt, stepSegments } from './clip-segments.ts';
import { measureLabel } from './label-measure.ts';

/** The closest the phone timeline zooms in: 400 px per second. */
export const MAX_SCALE = 0.4;
/** The lanes' inline padding (phone-editor.css .phone-lanes-content): the track starts this far in, at 0:00. */
export const PHONE_GUTTER_PX = 16;

/** Pixels per ms that fit the whole recording across a timeline `width` px wide, inside its gutters. */
export function fitScale(width: number, duration: number) {
  return Math.max(1e-4, (width - PHONE_GUTTER_PX * 2) / Math.max(1, duration));
}

/** A zoom kept between the fit (the whole recording on screen) and MAX_SCALE. */
export function clampScale(scale: number, fit: number) {
  return Math.min(Math.max(scale, fit), Math.max(MAX_SCALE, fit));
}

/** The phone track's time scale at `scale` px per ms, for the marks on it; `track` is measured only when a pointer asks. */
export function trackScale(duration: number, scale: number, track: Element | null): TimelineScale {
  return {
    duration,
    width: duration * scale,
    x: (time) => time * scale,
    timeAt: (clientX) => Math.min(Math.max((clientX - (track?.getBoundingClientRect().left ?? 0)) / scale, 0), duration),
  };
}

/** Where each recorded step starts on the timeline (inside the recording, once each): the snap points. */
export function stepBoundaries(steps: readonly Pick<ReplayStep, 'at'>[], duration: number) {
  return [...new Set(steps.map((step) => Math.round(step.at)).filter((at) => at > 0 && at < duration))].sort((a, b) => a - b);
}

/** The step line's inline padding (phone-editor.css .phone-step-line), which its words fit inside. */
const STEP_LINE_PAD_PX = 16;

/** The name of the clip step playing at `time` (original ms): its segment's label, a wait named by its length. */
export function stepLineLabel(
  steps: readonly Pick<ReplayStep, 'at' | 'label' | 'kind'>[],
  trim: { start: number; end: number },
  time: number,
) {
  return segmentAt(stepSegments(steps, trim), time - trim.start)?.label ?? '';
}

/** The phone step line's words: whole words that fit a line `width` px wide, never cut or ellipsed. */
export function stepLineText(label: string, width: number) {
  return wordsThatFit(label, width, { pad: STEP_LINE_PAD_PX, measure: measureLabel });
}

/** A run of neighbouring blocks too short for words, drawn as one span: its time and which blocks it holds. */
export interface ShortRun {
  from: number;
  to: number;
  /** Indexes into the lane's blocks. */
  members: number[];
}

/** why: blocks this close (ms) read as one stretch on the fitted phone scale, so they join a run. */
const RUN_GAP_MS = 100;

/**
 * Runs of two or more neighbouring blocks that are each too short for words (`short`), in time order, so a lane of
 * slivers reads as one span instead of a row of dashes. Blocks further apart than RUN_GAP_MS start a new run.
 */
export function shortRuns(blocks: readonly { from: number; to: number }[], short: readonly boolean[]) {
  const runs: ShortRun[] = [];
  let current: ShortRun | undefined;
  for (const [index, block] of blocks.entries()) {
    if (short[index] && current && block.from - current.to <= RUN_GAP_MS) {
      current.to = Math.max(current.to, block.to);
      current.members.push(index);
      continue;
    }
    if (current && current.members.length > 1) runs.push(current);
    current = short[index] ? { from: block.from, to: block.to, members: [index] } : undefined;
  }
  if (current && current.members.length > 1) runs.push(current);
  return runs;
}
