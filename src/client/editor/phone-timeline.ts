import type { ReplayStep } from '../../shared/replay.ts';
import type { TimelineScale } from './timeline-drag.ts';

/** The closest the phone timeline zooms in: 400 px per second. */
export const MAX_SCALE = 0.4;
/** Room left on each side of the whole recording when it is fitted to the screen. */
const FIT_MARGIN = 24;

/** Pixels per ms that fit the whole recording across a timeline `width` px wide. */
export function fitScale(width: number, duration: number) {
  return Math.max(1e-4, (width - FIT_MARGIN * 2) / Math.max(1, duration));
}

/** A zoom kept between half the fit (the whole recording, with room around it) and MAX_SCALE. */
export function clampScale(scale: number, fit: number) {
  return Math.min(Math.max(scale, fit / 2), Math.max(MAX_SCALE, fit));
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

/** The time under the centre playhead for a scroll offset: the lanes start half a screen in, at 0:00. */
export function timeAtScroll(scrollLeft: number, scale: number, duration: number) {
  return Math.min(Math.max(scrollLeft / scale, 0), duration);
}

/** Where each recorded step starts on the timeline (inside the recording, once each): the snap points. */
export function stepBoundaries(steps: readonly Pick<ReplayStep, 'at'>[], duration: number) {
  return [...new Set(steps.map((step) => Math.round(step.at)).filter((at) => at > 0 && at < duration))].sort((a, b) => a - b);
}

/** why: a conservative average for the 11 px label font, so a word judged to fit does fit. */
const LABEL_CHAR_PX = 6.6;
/** A label's inline padding on each side. */
const LABEL_PAD_PX = 6;

/** why: a shortened label ending on one of these ("Look at the") reads as cut off, so it ends before them. */
const DANGLING = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * As much of `label` as fits `width` px in up to `lines` lines, ending at a word boundary: never part of a word,
 * never an ellipsis, and a shortened label never ends on a small joining word. Empty when not even the first word fits.
 */
export function wordsThatFit(label: string, width: number, lines = 1) {
  const room = Math.floor((width - LABEL_PAD_PX * 2) / LABEL_CHAR_PX);
  const words = label.trim().split(/\s+/);
  const kept: string[] = [];
  let line = 1;
  let used = 0;
  for (const word of words) {
    const need = used ? used + 1 + word.length : word.length;
    if (need <= room) {
      used = need;
    } else if (line < lines && word.length <= room) {
      line += 1;
      used = word.length;
    } else break;
    kept.push(word);
  }
  if (kept.length < words.length) while (DANGLING.has(kept.at(-1)?.toLowerCase() ?? '')) kept.pop();
  return kept.join(' ');
}
