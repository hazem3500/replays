import type { CursorInput } from './cursor-motion.ts';

/** An authored caption avoids the recorded pointer when one edge stays clear. */
export type CaptionEdge = 'top' | 'bottom';

/** Recorded page geometry used for authored caption placement. */
export interface CaptionPage {
  input: CursorInput;
  first: number;
  height: number;
}

/** Preserves pointer-aware authored caption placement; automatic captions choose bottom at their render boundary. */
export function captionEdge({ input, first, height }: CaptionPage, { from, to }: { from: number; to: number }): CaptionEdge {
  if (!(height > 0) || !(to >= from)) return 'bottom';
  const start = first + from - 600;
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
    low ||= point.y >= height * 0.7;
    high ||= point.y <= height * 0.3;
  }
  if (before !== undefined) {
    low ||= before >= height * 0.7;
    high ||= before <= height * 0.3;
  }
  return low && !high ? 'top' : 'bottom';
}
