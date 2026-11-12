/**
 * Where a caption sits on the recorded frame: at the bottom edge (the default) or the top. A caption moves to the
 * top when, while it is up, the pointer or what the step clicks sits under its bottom pill, so the caption never
 * hides the action it names. The choice is made once per caption, for its whole span, from the recorded pointer, so
 * the viewer (viewer/StepCaption.tsx, edit-caption.tsx) and exported videos (render/main.ts) agree and a caption
 * never jumps mid-way. Everything is in recorded-viewport px on the replay clock (ms from the first event).
 */
import { captionDisplayText, captionIndex, captionSpan, exportCaptionScale } from './step-caption.ts';

export type CaptionPlace = 'bottom' | 'top';

/** The recorded pointer on the replay clock: positions (sorted by `t`), press times, and the recorded viewport. */
export interface PointerTrack {
  points: ReadonlyArray<{ t: number; x: number; y: number }>;
  presses: readonly number[];
  viewport: { width: number; height: number };
}

export interface CaptionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* invariant: the sizes below mirror step-caption.css at --caption-scale 1 (15 px text, 1.35 line height, 0.47em ×
   0.93em padding, an 18 px inset, a number circle of 1.82 × 0.733em plus a 0.53em gap, at most two lines). */
const FONT_PX = 15;
const INSET_PX = 18;
const LINE_EM = 1.35;
const PAD_Y_EM = 0.47;
const PAD_X_EM = 0.93;
const NUMBER_EM = 1.82 * 0.733 + 0.53 - (PAD_X_EM - PAD_Y_EM);
/** Average Inter advance at weight 550, in em; a little generous so the estimate covers the drawn pill. */
const CHAR_EM = 0.56;
/** The arrow is drawn below and right of its tip: a tip this close (× scale) to the pill still hides under it. */
const POINTER_REACH_PX = 14;
/** Pointer time under a zone below this (ms) is a pass-through, not something the caption hides. */
const MIN_COVER_MS = 150;
/** A press this long before a caption appears is that caption's own step being clicked. */
const PRESS_LEAD_MS = 300;

/**
 * The caption pill's estimated box for `text` at `place`, as exported (exportCaptionScale): centred, at most 76% of the
 * frame wide (21em on narrow frames, never past the sides), one line or two when the text does not fit.
 */
export function captionBox(place: CaptionPlace, text: string, viewport: { width: number; height: number }, numbered = true): CaptionBox {
  const scale = exportCaptionScale(viewport.width);
  const em = FONT_PX * scale;
  const maxWidth = Math.max(0, Math.min(viewport.width - 1.6 * em, Math.max(0.76 * viewport.width, 21 * em)));
  const natural = (text.length * CHAR_EM + 2 * PAD_X_EM + (numbered ? NUMBER_EM : 0)) * em;
  const lines = natural > maxWidth ? 2 : 1;
  const width = Math.min(natural, maxWidth);
  const height = (lines * LINE_EM + 2 * PAD_Y_EM) * em;
  const inset = INSET_PX * scale;
  return { x: (viewport.width - width) / 2, y: place === 'top' ? inset : viewport.height - inset - height, width, height };
}

function grow(box: CaptionBox, by: number): CaptionBox {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}

const inside = (box: CaptionBox, point: { x: number; y: number }) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

/** Index of the last point at or before `time`, or -1. */
function lastAt(points: PointerTrack['points'], time: number) {
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle]!.t <= time) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** Where the pointer is at `time`: its last recorded position, held until the next; undefined before the first. */
export function pointerAt(track: PointerTrack, time: number) {
  return track.points[lastAt(track.points, time)];
}

/**
 * How much of [from, to) the caption at `zone` covers, in ms: the time the pointer rests under it (ignoring a quick
 * pass-through), plus, for each press in the span, the rest of the span, since the clicked element stays on screen.
 */
function coverMs(track: PointerTrack, zone: CaptionBox, from: number, to: number) {
  const reach = grow(zone, POINTER_REACH_PX * exportCaptionScale(track.viewport.width));
  let pointer = 0;
  let index = lastAt(track.points, from);
  let at = from;
  while (at < to) {
    const next = track.points[index + 1];
    const until = Math.min(to, next ? Math.max(next.t, at) : to);
    const point = track.points[index];
    if (point && inside(reach, point)) pointer += until - at;
    at = until;
    index++;
    if (!next) break;
  }
  let targets = 0;
  for (const press of track.presses) {
    if (press < from - PRESS_LEAD_MS || press >= to) continue;
    const point = pointerAt(track, press);
    if (point && inside(zone, point)) targets += to - Math.max(from, press);
  }
  return (pointer >= MIN_COVER_MS ? pointer : 0) + targets;
}

/**
 * Bottom, unless during [from, to) the pointer or a clicked spot is under the bottom pill; then the top, unless the
 * top would cover as much or more (the side covering less wins; a tie stays at the bottom).
 */
export function placeCaption(track: PointerTrack, span: { from: number; to: number; text: string; numbered?: boolean }): CaptionPlace {
  const numbered = span.numbered ?? true;
  const bottom = coverMs(track, captionBox('bottom', span.text, track.viewport, numbered), span.from, span.to);
  if (bottom <= 0) return 'bottom';
  const top = coverMs(track, captionBox('top', span.text, track.viewport, numbered), span.from, span.to);
  return top < bottom ? 'top' : 'bottom';
}

/**
 * The place of every step caption, by caption index (step-caption.ts captionIndex; other entries are 'bottom'). Each
 * caption is placed once over its span (captionSpan), with its step number, as the export draws it.
 */
export function stepCaptionPlaces(
  steps: ReadonlyArray<{ at: number; label: string; kind?: string; folded?: true }>,
  track: PointerTrack,
  duration: number,
): CaptionPlace[] {
  const places: CaptionPlace[] = steps.map(() => 'bottom');
  const shown = new Set(steps.map((step) => captionIndex(steps, step.at, duration)));
  if (steps.length) shown.add(captionIndex(steps, 0, duration));
  for (const index of shown) {
    const step = steps[index];
    if (!step) continue;
    places[index] = placeCaption(track, { ...captionSpan(steps, index, duration), text: captionDisplayText(step.label) });
  }
  return places;
}

/** The place of every edit caption (src/shared/effects.ts), each over its own span, drawn without a number. */
export function editCaptionPlaces(
  captions: ReadonlyArray<{ from: number; to: number; text: string }>,
  track: PointerTrack,
): CaptionPlace[] {
  return captions.map((caption) => placeCaption(track, { from: caption.from, to: caption.to, text: caption.text, numbered: false }));
}

/** The live viewer fades a caption while the pointer is under its pill right now; exports never do. */
export function pointerUnderCaption(track: PointerTrack, time: number, place: CaptionPlace, text: string, numbered: boolean) {
  const point = pointerAt(track, time);
  if (!point) return false;
  const reach = POINTER_REACH_PX * exportCaptionScale(track.viewport.width);
  return inside(grow(captionBox(place, text, track.viewport, numbered), reach), point);
}
