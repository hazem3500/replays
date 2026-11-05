import { estimateLabelWidth } from './block-label.ts';

/** The lane labels' font at its boldest weight (editor.css, phone-editor.css), so a measured line never runs wider. */
const FONT = '600 11px "Inter Variable"';
/** why: canvas and layout round differently; a little slack keeps a measured word from touching the block's edge. */
const SLACK = 1.04;

let context: OffscreenCanvasRenderingContext2D | null | undefined;

/** A lane label line's width in px in the real font, or undefined before that font has loaded (or outside a browser). */
function measured(text: string) {
  if (context === undefined) context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!context || typeof document === 'undefined' || !document.fonts?.check(FONT)) return;
  context.font = FONT;
  return context.measureText(text).width * SLACK;
}

/** Measures a lane label line for block-label.ts: the real font's width once loaded, else its conservative estimate. */
export function measureLabel(text: string) {
  return measured(text) ?? estimateLabelWidth(text);
}
