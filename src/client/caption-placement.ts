import type { CursorInput } from './cursor-motion.ts';

/** The edge a caption sits on: bottom by default, top when the action it describes happens low on the page. */
export type CaptionEdge = 'top' | 'bottom';

/** A pointer at or below this share of the page's height works where a bottom caption sits. */
const LOW = 0.7;
/** A pointer at or above this share works where a top caption sits. */
const HIGH = 0.3;
/** The pointer's approach to the action a caption describes starts this long before the caption shows. */
const LEAD_MS = 600;

/** The recorded page a caption is placed against: its pointer track, first event's timestamp and height. */
export interface CaptionPage {
  input: CursorInput;
  first: number;
  height: number;
}

/**
 * Which edge of the recorded frame a caption sits on. The viewer, the editor's preview and the video export
 * (render/main.ts) all call this on the same recorded pointer, so they place a caption at the same edge.
 * `from`..`to` are replay ms (from the page's first event), the span the caption is up. The caption
 * moves to the top only when the pointer works in the page's lower part during that span (and its approach) and
 * never in the upper part: a pointer that crosses the whole page leaves it at the bottom, so it never jumps over to
 * cover the other end either.
 */
export function captionEdge({ input, first, height }: CaptionPage, { from, to }: { from: number; to: number }): CaptionEdge {
  if (!(height > 0) || !(to >= from)) return 'bottom';
  const start = first + from - LEAD_MS;
  const end = first + to;
  let low = false;
  let high = false;
  let before: number | undefined;
  for (const point of input.points) {
    if (point.t < start) {
      before = point.y;
      continue;
    }
    if (point.t > end) break;
    low ||= point.y >= height * LOW;
    high ||= point.y <= height * HIGH;
  }
  // why: a pointer resting since before the span still sits where it was last seen.
  if (before !== undefined) {
    low ||= before >= height * LOW;
    high ||= before <= height * HIGH;
  }
  return low && !high ? 'top' : 'bottom';
}
