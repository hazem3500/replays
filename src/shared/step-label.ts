/** Longest name a step label quotes (`Clicked “<name>”`). The recorder keeps a ported copy; test/step-label-parity.test.ts. */
export const STEP_LABEL_MAX = 48;

const TRAILING_SEPARATORS = /[\s,;:–—-]+$/u;
const TRAILING_ELLIPSIS = /(?:…|\.{3})+$/u;
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

/**
 * `text` on one line, shortened to at most `max` characters at a word boundary. A caption never ends in an ellipsis, so
 * none is added and one already there is dropped. A single word longer than `max` is cut at `max`.
 */
export function capAtWord(text: string, max: number = STEP_LABEL_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(TRAILING_ELLIPSIS, '').trimEnd();
  if (flat.length <= max) return flat;
  const space = flat.slice(0, max + 1).lastIndexOf(' ');
  const cut = space > 0 ? flat.slice(0, space) : flat.slice(0, max).replace(LONE_HIGH_SURROGATE, '');
  return cut.replace(TRAILING_SEPARATORS, '');
}

const TRAILING_PUNCTUATION = /[\s:;,–—-]+$/u;

/** A name worth quoting in a label: on one line, capped at a word, with no trailing colon or dash ("Profile:" → "Profile"). */
export function tidyStepName(text: string, max: number = STEP_LABEL_MAX): string {
  return capAtWord(text, max).replace(TRAILING_PUNCTUATION, '');
}
