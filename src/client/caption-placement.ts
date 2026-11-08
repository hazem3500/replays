import type { CursorInput } from './cursor-motion.ts';

/** An authored caption may choose either edge; automatic step captions stay at the bottom. */
export type CaptionEdge = 'top' | 'bottom';

/** Recorded page geometry retained for caller compatibility. */
export interface CaptionPage {
  input: CursorInput;
  first: number;
  height: number;
}

/** Keeps automatic viewer and export captions stable above the controls, independent of pointer movement. */
export function captionEdge(_page: CaptionPage, _span: { from: number; to: number }): CaptionEdge {
  return 'bottom';
}
