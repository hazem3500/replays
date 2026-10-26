/**
 * Replay effects: the parts of an edit list (src/shared/edits.ts) that change how the replay looks rather than which
 * moments it keeps. Auto-zoom follows clicks, blur boxes hide part of the page for a stretch, captions name what is
 * happening. Speed-up ranges change time, so they live in the edit timeline (edits.ts editTimeline).
 *
 * Effects are stored on the ORIGINAL timeline like every edit, then turned into `PlaybackEffects` on the EDITED
 * timeline (`playbackEffects`), which the viewer, the editor preview and the server's video render all draw from
 * (src/client/effects-layer.ts), so a blurred box is blurred in the MP4 exactly where it is in the viewer.
 *
 * Everything here is pure and identical in Node and the browser.
 */

import { normalizeCursor, type ReplayCursorSettings } from './cursor.ts';

/** Speed-up rates a range can play at. */
export const SPEED_RATES = [2, 4, 8] as const;
export type SpeedRate = (typeof SPEED_RATES)[number];

/** A stretch of the original replay played faster. */
export interface ReplaySpeedRange {
  id: string;
  /** Original ms; `from < to`. */
  from: number;
  to: number;
  rate: SpeedRate;
}

/** A box blurred over the recorded page for a stretch: position and size as fractions (0–1) of the recorded frame. */
export interface ReplayBlur {
  id: string;
  from: number;
  to: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A caption shown at the bottom of the replay for a stretch. */
export interface ReplayCaption {
  id: string;
  from: number;
  to: number;
  text: string;
}

/**
 * A zoom region: the view eases in at its start, follows the clicks inside it (panning from one to the next) and
 * eases back out at its end. Without clicks it holds on (`x`, `y`), fractions of the frame (the centre if absent).
 * "Auto-zoom" proposes one per run of clicks (`proposeZoomRegions`).
 */
export interface ReplayZoomRegion {
  id: string;
  from: number;
  to: number;
  scale: number;
  x?: number;
  y?: number;
}

export const ZOOM_SCALES = [1.4, 1.8, 2.2] as const;
export const DEFAULT_ZOOM_SCALE = 1.8;
export const MIN_ZOOM_SCALE = 1.1;
export const MAX_ZOOM_SCALE = 3;
/** Most blur boxes / captions / speed ranges one replay can hold. */
export const MAX_EFFECTS = 100;
export const MAX_CAPTION = 160;
/** Smallest blur box side, as a fraction of the frame. */
export const MIN_BLUR_SIZE = 0.01;

/* ---------- Edited timeline ---------- */

/** What effects need from the edit timeline: original → edited time. */
interface TimeMap {
  toEdited(time: number): number;
  duration: number;
}

export interface PlaybackClick {
  /** Edited ms. */
  at: number;
  /** Recorded page px. */
  x: number;
  y: number;
}

/** Effects on the edited timeline, ready to draw. */
export interface PlaybackZoom {
  from: number;
  to: number;
  scale: number;
  /** Clicks inside the region (edited ms, recorded px), in order. */
  clicks: PlaybackClick[];
  /** Where it holds without clicks: fractions of the frame. */
  x: number;
  y: number;
}

export interface PlaybackEffects {
  cursor?: ReplayCursorSettings;
  zooms: PlaybackZoom[];
  blurs: Array<Omit<ReplayBlur, 'id'>>;
  captions: Array<Omit<ReplayCaption, 'id'>>;
}

export const NO_EFFECTS: PlaybackEffects = { zooms: [], blurs: [], captions: [] };

export function hasEffects(effects: PlaybackEffects | undefined) {
  return Boolean(effects && (effects.zooms.length || effects.blurs.length || effects.captions.length || normalizeCursor(effects.cursor)));
}

const INCREMENTAL = 3;
const MOUSE_INTERACTION = 2;
const CLICK = 2;
const TOUCH_END = 9;

/** Clicks (and taps) in rrweb events, relative to the first event, in order. */
export function clicksOf(events: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>): PlaybackClick[] {
  const first = events[0]?.timestamp ?? 0;
  const clicks: PlaybackClick[] = [];
  for (const event of events) {
    if (event.type !== INCREMENTAL || !event.data || typeof event.data !== 'object') continue;
    const data = event.data as { source?: unknown; type?: unknown; x?: unknown; y?: unknown };
    if (data.source !== MOUSE_INTERACTION || (data.type !== CLICK && data.type !== TOUCH_END)) continue;
    if (typeof data.x !== 'number' || typeof data.y !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.y)) continue;
    clicks.push({ at: event.timestamp - first, x: data.x, y: data.y });
  }
  return clicks.sort((a, b) => a.at - b.at);
}

/** Moves stretches to the edited timeline; a stretch that is removed entirely is dropped. */
function mapStretches<T extends { from: number; to: number }>(items: readonly T[] | undefined, timeline: TimeMap) {
  const mapped: Array<Omit<T, 'id'>> = [];
  for (const item of items ?? []) {
    const from = timeline.toEdited(item.from);
    const to = timeline.toEdited(item.to);
    if (to - from < 1) continue;
    const { id: _id, ...rest } = item as T & { id?: string };
    mapped.push({ ...rest, from, to });
  }
  return mapped.sort((a, b) => a.from - b.from);
}

/**
 * The effects of an edit list on the edited timeline. `editedEvents` are the edited bundle's events (edits.ts
 * applyEdits): auto-zoom follows the clicks that are left.
 */
export function playbackEffects(
  edits: { zooms?: ReplayZoomRegion[]; blurs?: ReplayBlur[]; captions?: ReplayCaption[]; cursor?: ReplayCursorSettings } | undefined,
  timeline: TimeMap,
  editedEvents: ReadonlyArray<{ timestamp: number; type?: unknown; data?: unknown }>,
): PlaybackEffects {
  if (!edits) return NO_EFFECTS;
  const cursor = normalizeCursor(edits.cursor);
  const clicks = edits.zooms?.length ? clicksOf(editedEvents) : [];
  const zooms = mapStretches(edits.zooms, timeline).map((zoom) => ({
    from: zoom.from,
    to: zoom.to,
    scale: zoom.scale,
    x: zoom.x ?? 0.5,
    y: zoom.y ?? 0.5,
    clicks: clicks.filter((click) => click.at >= zoom.from && click.at < zoom.to),
  }));
  return {
    zooms,
    blurs: mapStretches(edits.blurs, timeline),
    captions: mapStretches(edits.captions, timeline),
    ...(cursor ? { cursor } : {}),
  };
}

/** Original-timing effects for the editor's preview, which plays the original replay (cuts skipped live). */
export const IDENTITY_TIME = (duration: number): TimeMap => ({ toEdited: (time) => time, duration });

/* ---------- Zoom ---------- */

/** Easing into and out of a zoom region (shortened for short regions), and the pan from one click to the next. */
export const ZOOM_IN_MS = 600;
export const ZOOM_OUT_MS = 700;
export const ZOOM_PAN_MS = 650;
/** "Auto-zoom": a region starts this long before a run's first click and holds this long after its last. */
export const ZOOM_LEAD_MS = 700;
export const ZOOM_TAIL_MS = 1500;
/** Clicks closer than this share one proposed region. */
export const ZOOM_MERGE_MS = 2500;

/** Smooth in and out (cubic), like a camera move. */
const easeInOut = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** The view at a moment: zoom `scale` around the page point (`x`, `y`, recorded px). */
export interface ZoomPose {
  scale: number;
  x: number;
  y: number;
}

/** The zoom pose at edited `time` in a `viewport`-sized frame (scale 1 outside every region). */
export function zoomAt(zooms: readonly PlaybackZoom[], time: number, viewport: { width: number; height: number }): ZoomPose {
  const zoom = zooms.find((region) => time >= region.from && time < region.to);
  if (!zoom) return { scale: 1, x: 0, y: 0 };
  const length = zoom.to - zoom.from;
  const into = Math.min(ZOOM_IN_MS, length / 3);
  const out = Math.min(ZOOM_OUT_MS, length / 3);
  const amount =
    time < zoom.from + into
      ? easeInOut((time - zoom.from) / into)
      : time > zoom.to - out
        ? 1 - easeInOut((time - (zoom.to - out)) / out)
        : 1;
  let x = zoom.x * viewport.width;
  let y = zoom.y * viewport.height;
  if (zoom.clicks.length) {
    // Anchor: the latest click (the first before it lands), panning to the next one just before it lands.
    let index = 0;
    while (index + 1 < zoom.clicks.length && zoom.clicks[index + 1]!.at <= time) index++;
    const current = zoom.clicks[index]!;
    const next = zoom.clicks[index + 1];
    x = current.x;
    y = current.y;
    if (next && time > current.at) {
      const pan = Math.min(ZOOM_PAN_MS, next.at - current.at);
      const progress = pan > 0 ? easeInOut((time - (next.at - pan)) / pan) : 0;
      x += (next.x - current.x) * progress;
      y += (next.y - current.y) * progress;
    }
  }
  return { scale: 1 + (zoom.scale - 1) * amount, x, y };
}

/**
 * The CSS transform (origin 0 0) that shows `pose` in a `viewport`-sized frame: the anchor point centred where it can
 * be, never leaving an empty edge.
 */
export function zoomTransform(pose: ZoomPose, viewport: { width: number; height: number }) {
  if (pose.scale <= 1.0005) return { scale: 1, x: 0, y: 0 };
  const axis = (anchor: number, size: number) => Math.min(0, Math.max(size - pose.scale * size, size / 2 - pose.scale * anchor));
  return { scale: pose.scale, x: axis(pose.x, viewport.width), y: axis(pose.y, viewport.height) };
}

/**
 * "Auto-zoom": one region per run of clicks (clicks closer than ZOOM_MERGE_MS share one), from ZOOM_LEAD_MS before
 * the first to ZOOM_TAIL_MS after the last, skipping runs an existing region already covers. Original timeline.
 */
export function proposeZoomRegions(
  clicks: readonly PlaybackClick[],
  duration: number,
  existing: ReadonlyArray<{ from: number; to: number }> = [],
  scale = DEFAULT_ZOOM_SCALE,
  id: (index: number) => string = (index) => `zoom-${index + 1}`,
): ReplayZoomRegion[] {
  const runs: PlaybackClick[][] = [];
  for (const click of clicks) {
    const run = runs.at(-1);
    if (run && click.at - run.at(-1)!.at < ZOOM_MERGE_MS) run.push(click);
    else runs.push([click]);
  }
  const regions: ReplayZoomRegion[] = [];
  for (const run of runs) {
    const from = Math.max(0, Math.round(run[0]!.at - ZOOM_LEAD_MS));
    const to = Math.min(Math.round(duration), Math.round(run.at(-1)!.at + ZOOM_TAIL_MS));
    if (to - from < 300) continue;
    if (existing.some((range) => range.from < to && range.to > from)) continue;
    regions.push({ id: id(regions.length), from, to, scale });
  }
  return regions;
}

/* ---------- Blurs and captions ---------- */

/** Whole hundredths of a px. */
const px = (value: number) => Math.round(value * 100) / 100;

/**
 * Where a blur box lands on screen (recorded px in the unzoomed frame) under a zoom `transform`, clipped to the
 * frame; undefined when nothing of it is in view. Blur boxes are drawn outside the zoomed page and never cross the
 * frame's edge: Chromium drops a backdrop-filter whose box reaches past a clipping ancestor, which would show the very
 * content the box is there to hide.
 */
export function blurRect(
  blur: Pick<ReplayBlur, 'x' | 'y' | 'width' | 'height'>,
  transform: { scale: number; x: number; y: number },
  viewport: { width: number; height: number },
) {
  const left = Math.max(0, transform.x + transform.scale * blur.x * viewport.width);
  const top = Math.max(0, transform.y + transform.scale * blur.y * viewport.height);
  const right = Math.min(viewport.width, transform.x + transform.scale * (blur.x + blur.width) * viewport.width);
  const bottom = Math.min(viewport.height, transform.y + transform.scale * (blur.y + blur.height) * viewport.height);
  if (right - left < 0.5 || bottom - top < 0.5) return undefined;
  return { left: px(left), top: px(top), width: px(right - left), height: px(bottom - top) };
}

/** Indices of the blur boxes shown at edited `time`. */
export function blursAt(blurs: PlaybackEffects['blurs'], time: number) {
  const shown: number[] = [];
  for (const [index, blur] of blurs.entries()) if (time >= blur.from && time < blur.to) shown.push(index);
  return shown;
}

/** The caption shown at edited `time`, with how long ago (edited ms, or output ms via `outputAt`) it appeared. */
export function editCaptionAt(
  captions: PlaybackEffects['captions'],
  time: number,
  outputAt: (time: number) => number = (at) => at,
): { index: number; label: string; enteredMs: number } | undefined {
  let found: number | undefined;
  for (const [index, caption] of captions.entries()) if (time >= caption.from && time < caption.to) found = index;
  if (found === undefined) return undefined;
  const caption = captions[found]!;
  return { index: found, label: caption.text, enteredMs: Math.max(0, outputAt(time) - outputAt(caption.from)) };
}

/** Changes whenever what the effects draw at `time` changes: the render captures a new frame then. */
export function effectsKey(effects: PlaybackEffects, viewport: { width: number; height: number }, time: number) {
  const zoom = zoomTransform(zoomAt(effects.zooms, time, viewport), viewport);
  const zoomPart = zoom.scale === 1 ? '' : `${zoom.scale.toFixed(3)},${zoom.x.toFixed(1)},${zoom.y.toFixed(1)}`;
  return `${zoomPart}|${blursAt(effects.blurs, time).join(',')}`;
}

/* ---------- Proposals ---------- */

/** Longest a caption from a step stays up. */
export const STEP_CAPTION_MAX_MS = 5000;

/**
 * "Captions from steps": one caption per step, from the step until the next one (at most STEP_CAPTION_MAX_MS), its
 * label as the text. Original timeline; `id` names each.
 */
export function proposeStepCaptions(
  steps: ReadonlyArray<{ at: number; label: string }>,
  duration: number,
  id: (index: number) => string = (index) => `caption-${index + 1}`,
): ReplayCaption[] {
  const order = [...steps].sort((a, b) => a.at - b.at);
  const captions: ReplayCaption[] = [];
  for (const [index, step] of order.entries()) {
    const text = step.label.trim().slice(0, MAX_CAPTION);
    const next = order[index + 1]?.at ?? duration;
    const from = Math.max(0, Math.round(step.at));
    const to = Math.round(Math.min(duration, next, from + STEP_CAPTION_MAX_MS));
    if (!text || to - from < 100) continue;
    captions.push({ id: id(captions.length), from, to, text });
  }
  return captions;
}
