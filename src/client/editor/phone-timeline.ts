import type { ReplayStep } from '../../shared/replay.ts';
import type { TimelineScale } from './timeline-drag.ts';

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
