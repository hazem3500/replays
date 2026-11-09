/* why: the recorder bundle may not import shared source, so this is a port of src/shared/step-label.ts; the parity
   test test/step-label-parity.test.ts keeps the two identical. */

export const STEP_LABEL_MAX = 48;

const TRAILING_SEPARATORS = /[\s,;:–—-]+$/u;
const TRAILING_ELLIPSIS = /(?:…|\.{3})+$/u;
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

/** `text` on one line, shortened to at most `max` characters at a word boundary, with no ellipsis added or kept. */
export function capAtWord(text: string, max: number = STEP_LABEL_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(TRAILING_ELLIPSIS, '').trimEnd();
  if (flat.length <= max) return flat;
  const space = flat.slice(0, max + 1).lastIndexOf(' ');
  const cut = space > 0 ? flat.slice(0, space) : flat.slice(0, max).replace(LONE_HIGH_SURROGATE, '');
  return cut.replace(TRAILING_SEPARATORS, '');
}

const TRAILING_PUNCTUATION = /[\s:;,–—-]+$/u;

export function tidyStepName(text: string, max: number = STEP_LABEL_MAX): string {
  return capAtWord(text, max).replace(TRAILING_PUNCTUATION, '');
}
