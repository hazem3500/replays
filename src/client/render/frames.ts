import { PLAYBACK_SPEEDS } from '../../shared/render-variant.ts';
/**
 * Frame planning for the server-side video render (src/server/renderer.ts
 * drives src/client/render/main.ts). Pure: no DOM, unit-tested in
 * test/render-frames.test.ts.
 *
 * Frame `i` shows replay time `times[i]` (exportTimes: the replay at the chosen
 * speed, idle gaps fast-forwarded with "skip inactive"). A frame is dirty, and so worth
 * a fresh screenshot, only when an rrweb event landed in (previous, t], the
 * replay cursor's pose changed or (captioned exports) the step caption changed;
 * clean frames repeat the previous image.
 */

import { INACTIVE_SKIP_SPEED, INACTIVE_THRESHOLD_MS } from '../../shared/skip.ts';
import type { PosterMoment } from '../../shared/profiles.ts';

export const RENDER_FPS = [15, 30] as const;
export type RenderFps = (typeof RENDER_FPS)[number];
/** Export speeds: the viewer's playback speeds (src/client/player.ts SPEEDS). */
export const RENDER_SPEEDS = PLAYBACK_SPEEDS;
export type RenderSpeed = (typeof RENDER_SPEEDS)[number];

/** Number of frames for `duration` ms of replay at `fps`, played at `speed`; the last frame lands on the end. */
export function frameCount(duration: number, fps: number, speed: number) {
  return Math.max(1, Math.ceil((Math.max(0, duration) / speed / 1000) * fps) + 1);
}

/** Replay time (ms from the first event) shown by frame `index`, clamped to the duration. */
export function frameTime(index: number, fps: number, speed: number, duration: number) {
  return Math.min(duration, Math.round(((index * 1000) / fps) * speed * 1000) / 1000);
}

/**
 * A piecewise-linear map between replay time and output (video) time: each piece is a stretch of replay
 * (`from`–`to`, ascending, contiguous) and the output time it takes. Exports (exportMap) and hover previews
 * (previewPlan) both plan their frames through one.
 */
export interface PlaybackMap {
  /** Output length, ms. */
  outputMs: number;
  /** Replay time shown at output time `output`. */
  replayAt(output: number): number;
  /** Output time at which replay time `time` is shown. */
  outputAt(time: number): number;
}

export function playbackMap(pieces: ReadonlyArray<{ from: number; to: number; outputMs: number }>): PlaybackMap {
  const spans: Array<{ from: number; to: number; start: number; end: number }> = [];
  let output = 0;
  for (const piece of pieces) {
    if (piece.to <= piece.from) continue;
    spans.push({ from: piece.from, to: piece.to, start: output, end: output + piece.outputMs });
    output += piece.outputMs;
  }
  return {
    outputMs: output,
    replayAt(at) {
      const span = spans.find((item) => at <= item.end) ?? spans.at(-1);
      if (!span) return 0;
      const { from, to, start, end } = span;
      return end === start ? to : from + ((Math.min(at, end) - start) / (end - start)) * (to - from);
    },
    outputAt(time) {
      const span = spans.find((item) => time <= item.to) ?? spans.at(-1);
      if (!span) return 0;
      const { from, to, start, end } = span;
      return start + ((Math.max(from, Math.min(time, to)) - from) / (to - from)) * (end - start);
    },
  };
}

/**
 * The export's timeline: the replay at `speed`, and with "skip inactive" its idle gaps (src/shared/skip.ts
 * idleGaps) fast-forwarded at max(speed, INACTIVE_SKIP_SPEED), exactly as the viewer plays them.
 */
export function exportMap(options: { duration: number; speed: number; gaps?: ReadonlyArray<{ from: number; to: number }> }): PlaybackMap {
  const { duration, speed } = options;
  const fast = Math.max(speed, INACTIVE_SKIP_SPEED);
  const pieces: Array<{ from: number; to: number; outputMs: number }> = [];
  let at = 0;
  for (const gap of options.gaps ?? []) {
    const from = Math.max(at, Math.min(duration, gap.from));
    const to = Math.min(duration, gap.to);
    if (to <= from) continue;
    if (from > at) pieces.push({ from: at, to: from, outputMs: (from - at) / speed });
    pieces.push({ from, to, outputMs: (to - from) / fast });
    at = to;
  }
  if (duration > at) pieces.push({ from: at, to: duration, outputMs: (duration - at) / speed });
  return playbackMap(pieces);
}

/** Replay time of every export frame at `fps`; the last frame lands on the end. */
export function exportTimes(map: PlaybackMap, fps: number, duration: number) {
  const count = Math.max(1, Math.ceil((map.outputMs / 1000) * fps) + 1);
  return Array.from({ length: count }, (_, index) =>
    Math.min(duration, Math.round(map.replayAt(Math.min(map.outputMs, (index * 1000) / fps)) * 1000) / 1000),
  );
}

/**
 * Indices of the frames (replay `times`, ascending) that need a screenshot: the first, and any whose time
 * crossed an rrweb event since the previous frame or whose `key` (cursor pose, caption) changed.
 */
export function dirtyAt(times: readonly number[], eventTimes: ArrayLike<number>, key?: (time: number) => string) {
  const dirty: number[] = [];
  let next = 0; // first event index not yet covered by a previous frame
  let previousKey = '';
  for (const [index, time] of times.entries()) {
    let changed = index === 0;
    while (next < eventTimes.length && (eventTimes[next] as number) <= time) {
      changed = true;
      next++;
    }
    if (key) {
      const value = key(time);
      if (value !== previousKey) changed = true;
      previousKey = value;
    }
    if (changed) dirty.push(index);
  }
  return dirty;
}

/**
 * Indices of the frames that need a screenshot. `eventTimes` are the rrweb
 * events' times relative to the first event, ascending. `cursorKey` returns a
 * string that changes whenever the drawn cursor changes (pose rounded to what
 * is visible). `captionKey`, when captions are drawn, changes whenever the
 * caption does (another step, or a moment of its entrance; step-caption.ts).
 * `gaps`: idle gaps skipped as in the viewer (exportMap).
 */
export function dirtyFrames(options: {
  duration: number;
  fps: number;
  speed: number;
  eventTimes: ArrayLike<number>;
  cursorKey: (time: number) => string;
  captionKey?: (time: number) => string;
  gaps?: ReadonlyArray<{ from: number; to: number }>;
}): number[] {
  const { duration, fps, speed, eventTimes, cursorKey, captionKey } = options;
  const times = exportTimes(exportMap({ duration, speed, ...(options.gaps ? { gaps: options.gaps } : {}) }), fps, duration);
  return dirtyAt(times, eventTimes, captionKey ? (time) => `${cursorKey(time)}|${captionKey(time)}` : cursorKey);
}

/** Cursor pose rounded to what a frame can show: sub-pixel moves and tiny rotations do not redraw. */
export function poseKey(pose: {
  visible: boolean;
  x: number;
  y: number;
  heading: number;
  scale: number;
  opacity?: number;
  press?: number;
}) {
  const opacity = pose.opacity ?? 1;
  if (!pose.visible || opacity <= 0) return 'hidden';
  // why: a theme's click ripple or pulse keeps changing after the squish ends, so a press is part of the frame.
  const press = pose.press !== undefined && pose.press >= 0 ? `,p${Math.round(pose.press / 10)}` : '';
  return `${pose.x.toFixed(1)},${pose.y.toFixed(1)},${pose.heading.toFixed(2)},${pose.scale.toFixed(3)},${opacity.toFixed(2)}${press}`;
}

/** How long after the first full snapshot the poster is taken: the page has painted and settled, usually before the first step. */
export const POSTER_DELAY_MS = 1000;

/**
 * The poster moment, "first meaningful paint": one second after the first full snapshot (the first
 * rebuilt document), clamped to the replay. Not the first error: a thumbnail is for recognising the
 * page; errors are already shown on the row's timeline.
 */
export function posterTime(snapshotTimes: ArrayLike<number>, duration: number) {
  const first = snapshotTimes.length > 0 ? (snapshotTimes[0] as number) : 0;
  return Math.max(0, Math.min(duration, first + POSTER_DELAY_MS));
}

/** Inputs of the poster moment; every time is ms on the replay timeline. */
export interface PosterMomentInput {
  stepTimes: readonly number[];
  snapshotTimes: ArrayLike<number>;
  duration: number;
  /** Console errors and failed requests, for `moment: 'first-error'`. */
  errorTimes?: readonly number[];
  /** The replay's profile's choice (src/shared/profiles.ts); default `'middle-step'`. */
  moment?: PosterMoment;
  /** A time a plugin chose (`api.render({ posterAt })`); wins over `moment`, still clamped like the others. */
  at?: number;
}

/** After this long a step's effects (navigation, re-render) have usually landed. */
const SETTLE_MS = 900;

/**
 * Where the poster is taken, so thumbnails tell replays apart:
 * - `middle-step` (default): the middle, right after the step nearest it settled;
 * - `first-error`: just after the first error shows (middle-step when there is none);
 * - `last-step`: after the last step settled (the end result), or just before the end.
 * `at` (a plugin's time) wins over all three. Never before the first document exists; falls back to posterTime when
 * nothing applies.
 */
export function posterMoment({
  stepTimes,
  snapshotTimes,
  duration,
  errorTimes = [],
  moment = 'middle-step',
  at: chosen,
}: PosterMomentInput) {
  const fallback = posterTime(snapshotTimes, duration);
  const first = snapshotTimes.length > 0 ? (snapshotTimes[0] as number) : 0;
  const clamp = (time: number) => Math.max(0, Math.min(duration, Math.max(first + 300, time)));
  const steps = [...stepTimes].filter((at) => Number.isFinite(at)).sort((a, b) => a - b);
  const settledAfter = (index: number) => {
    const next = steps[index + 1];
    return Math.min(steps[index]! + SETTLE_MS, next === undefined ? duration : Math.max(steps[index]!, next - 50));
  };
  if (chosen !== undefined && Number.isFinite(chosen)) return clamp(chosen);
  if (moment === 'first-error') {
    const error = errorTimes.filter((at) => Number.isFinite(at)).sort((a, b) => a - b)[0];
    if (error !== undefined) return clamp(error + 600);
  }
  if (moment === 'last-step') {
    const last = steps.at(-1);
    return clamp(last === undefined ? duration - 100 : Math.min(duration - 100, last + 1500));
  }
  if (steps.length > 0) {
    const middle = duration / 2;
    let nearest = 0;
    for (const [index, at] of steps.entries()) if (Math.abs(at - middle) < Math.abs(steps[nearest]! - middle)) nearest = index;
    return clamp(settledAfter(nearest));
  }
  return duration > 0 ? clamp(duration / 2) : fallback;
}

export const PREVIEW_SPEED = 3;
/** Longest preview clip (output time). At 3× that is the first 45 s of (squeezed) replay. */
export const PREVIEW_MAX_OUTPUT_MS = 15_000;
/** Idle gaps longer than this are squeezed to it: the same threshold as the viewer's "skip inactive". */
export const PREVIEW_IDLE_MS = INACTIVE_THRESHOLD_MS;

export interface PreviewPlan {
  /** Replay time shown by each output frame. */
  times: number[];
  /** Frames whose replay time crossed an event since the previous frame (worth a fresh screenshot). */
  dirty: number[];
  /** True when the clip stops before the end of the replay. */
  capped: boolean;
  /** Replay time (ms, real) the clip covers. */
  coveredMs: number;
}

/**
 * Frames for the hover preview: the replay at `speed` with idle gaps squeezed to `idleMs`,
 * cut at `maxOutputMs` of output. `eventTimes` are rrweb event times (ms from the first event), ascending.
 */
export function previewPlan(options: {
  eventTimes: ArrayLike<number>;
  duration: number;
  fps: number;
  speed?: number;
  maxOutputMs?: number;
  idleMs?: number;
}): PreviewPlan {
  const { eventTimes, duration, fps } = options;
  const speed = options.speed ?? PREVIEW_SPEED;
  const maxOutputMs = options.maxOutputMs ?? PREVIEW_MAX_OUTPUT_MS;
  const idleMs = options.idleMs ?? PREVIEW_IDLE_MS;
  // Each stretch between events, idle ones squeezed to `idleMs`; the map's output is squeezed time, played at `speed`.
  const anchors = [0, ...Array.from(eventTimes, Number).filter((at) => at > 0 && at < duration), duration];
  const map = playbackMap(
    anchors.slice(1).map((to, index) => {
      const from = anchors[index]!;
      return { from, to, outputMs: Math.min(to - from, idleMs) };
    }),
  );
  const covered = Math.min(map.outputMs, maxOutputMs * speed);
  const count = Math.max(1, Math.floor((covered / speed / 1000) * fps) + 1);
  const times = Array.from(
    { length: count },
    (_, index) => Math.round(map.replayAt(Math.min(covered, ((index * 1000) / fps) * speed)) * 1000) / 1000,
  );
  return { times, dirty: dirtyAt(times, eventTimes), capped: covered < map.outputMs, coveredMs: Math.round(map.replayAt(covered)) };
}
