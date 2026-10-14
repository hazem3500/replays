/**
 * Step captions, shared by the viewer (Viewer.tsx StepCaption, while playing) and the server-side video
 * export (src/client/render/main.ts, frame by frame). Both use step-caption.css; the pure helpers below
 * say which step is captioned at a replay time and how far its entrance animation has run, so the render
 * page can pose the same CSS animation deterministically for any frame.
 */
import './step-caption.css';

import { activeStepIndex } from './timeline.ts';

/** Length of the caption's entrance, `caption-in` in step-caption.css (keep in sync). */
export const CAPTION_IN_MS = 200;

/** The step captioned at `time`: the active step, so the caption and the step rail always agree. */
export function captionIndex(steps: ReadonlyArray<{ at: number }>, time: number, duration: number) {
  return activeStepIndex(steps, time, duration);
}

export interface CaptionFrame {
  index: number;
  label: string;
  /** Output (wall-clock) ms since this caption appeared; at or above CAPTION_IN_MS it has settled. */
  enteredMs: number;
}

/**
 * The caption a video frame at replay `time` shows. A caption appears when its step starts (the first one
 * at the start of the video, even if its step is logged later); its entrance runs in output time
 * (`outputAt`: replay time → video time, frames.ts exportMap), like the viewer's CSS animation runs in
 * wall-clock time at any playback speed or skip.
 */
export function captionAt(
  steps: ReadonlyArray<{ at: number; label: string }>,
  time: number,
  duration: number,
  outputAt: (time: number) => number = (at) => at,
): CaptionFrame | undefined {
  const index = captionIndex(steps, time, duration);
  const step = steps[index];
  if (!step) return undefined;
  // The first caption is up from the start; a later one enters at its step, or is already settled at the very end.
  const shownSince = index === 0 ? 0 : step.at <= time ? step.at : Number.NEGATIVE_INFINITY;
  const enteredMs = Number.isFinite(shownSince) ? Math.max(0, outputAt(time) - outputAt(shownSince)) : Number.POSITIVE_INFINITY;
  return { index, label: step.label, enteredMs };
}

/** Changes whenever the drawn caption changes: another step, or another moment of its entrance. */
export function captionKey(frame: CaptionFrame | undefined) {
  if (!frame) return '';
  return frame.enteredMs < CAPTION_IN_MS ? `${frame.index}@${frame.enteredMs.toFixed(1)}` : `${frame.index}`;
}

/** Reference export width: captions are EXPORT_CAPTION_SCALE× the viewer's at this recorded viewport width. */
const EXPORT_CAPTION_WIDTH = 1440;
const EXPORT_CAPTION_SCALE = 1.6;

/**
 * `--caption-scale` for exported videos: a video is watched full-screen, not inside the viewer's chrome, so its
 * caption is larger (1.6× at 1440 px wide: 22 px text, 29 px from the bottom) and proportional to the recorded
 * viewport, never smaller than the viewer's and at most 2.4×.
 */
export function exportCaptionScale(viewportWidth: number) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.round(Math.min(2.4, Math.max(1, (EXPORT_CAPTION_SCALE * viewportWidth) / EXPORT_CAPTION_WIDTH)) * 1000) / 1000;
}
