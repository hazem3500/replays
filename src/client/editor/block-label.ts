/** why: a conservative average for the 11 px label font, so a word judged to fit does fit. */
const LABEL_CHAR_PX = 6.6;
/** A label's inline padding on each side, unless its block says otherwise. */
const LABEL_PAD_PX = 6;
/** The narrowest block that still holds its lane's 10 px glyph with a little room around it. */
export const GLYPH_MIN_PX = 14;

/** why: a shortened label ending on one of these ("Look at the") reads as cut off, so it ends before them. */
const DANGLING = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);

export interface LabelRoom {
  /** How many lines the block holds. */
  lines?: number;
  /** The block's inline padding on each side, in px. */
  pad?: number;
  /** A line's width in px (label-measure.ts measures the real font); a conservative per-character estimate by default. */
  measure?: (text: string) => number;
}

/** A label line's width by the conservative per-character estimate. */
export const estimateLabelWidth = (text: string) => text.length * LABEL_CHAR_PX;

/**
 * As much of `label` as fits `width` px in up to `lines` lines, ending at a word boundary: never part of a word,
 * never an ellipsis, and a shortened label never ends on a small joining word. Empty when not even the first word fits.
 */
export function wordsThatFit(
  label: string,
  width: number,
  { lines = 1, pad = LABEL_PAD_PX, measure = estimateLabelWidth }: LabelRoom = {},
) {
  const room = width - pad * 2;
  const words = label.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let line = 1;
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= room) {
      current = next;
    } else if (line < lines && measure(word) <= room) {
      line += 1;
      current = word;
    } else break;
    kept.push(word);
  }
  if (kept.length < words.length) while (DANGLING.has(kept.at(-1)?.toLowerCase() ?? '')) kept.pop();
  return kept.join(' ');
}

/**
 * What a labelled block on a lane shows: its leading whole words when at least one fits, else its lane's glyph when
 * the block has room for it, so a labelled block never looks empty. The full label stays in its tooltip and name.
 */
export function blockLabel(label: string, width: number, room: LabelRoom = {}) {
  const text = wordsThatFit(label, width, room);
  return { text, glyph: !text && label.trim() !== '' && width >= GLYPH_MIN_PX };
}
