import { animate } from 'motion/mini';

type Glyph = { text: string; node: HTMLSpanElement };
type TextState = { text: string; glyphs: Glyph[]; animations: Set<ReturnType<typeof animate>>; originalLabel: string | null };
const states = new WeakMap<HTMLElement, TextState>();
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;
const characters = (text: string) => (segmenter ? [...segmenter.segment(text)].map(({ segment }) => segment) : Array.from(text));

function cancelAnimations(state: TextState) {
  for (const animation of state.animations) {
    animation.stop();
  }
  state.animations.clear();
  for (const { node } of state.glyphs) {
    node.style.opacity = '';
    node.style.transform = '';
  }
}

/** Match shared glyphs without mounting two copies of the label. */
function shared(previous: Glyph[], next: string[]): Map<number, Glyph> {
  const matched = new Map<number, Glyph>();
  // why: recorder labels are short. Bound the diff work for arbitrary host messages.
  if (previous.length > 160 || next.length > 160) {
    let prefix = 0;
    while (prefix < previous.length && previous[prefix]?.text === next[prefix]) {
      matched.set(prefix, previous[prefix]!);
      prefix++;
    }
    let before = previous.length - 1;
    let after = next.length - 1;
    while (before >= prefix && after >= prefix && previous[before]?.text === next[after]) {
      matched.set(after--, previous[before--]!);
    }
    return matched;
  }
  const width = next.length + 1;
  const lengths = new Uint16Array((previous.length + 1) * width);
  for (let before = previous.length - 1; before >= 0; before--) {
    for (let after = next.length - 1; after >= 0; after--) {
      lengths[before * width + after] =
        previous[before]?.text === next[after]
          ? 1 + lengths[(before + 1) * width + after + 1]!
          : Math.max(lengths[(before + 1) * width + after]!, lengths[before * width + after + 1]!);
    }
  }
  let before = 0;
  let after = 0;
  while (before < previous.length && after < next.length) {
    if (previous[before]?.text === next[after]) matched.set(after++, previous[before++]!);
    else if (lengths[(before + 1) * width + after]! >= lengths[before * width + after + 1]!) before++;
    else after++;
  }
  return matched;
}

/**
 * Update a recorder label in place. Shared glyphs survive; only entering glyphs
 * receive a short Motion mini animation. No React, overlays, duplicated labels or
 * animation frames are required. The parent retains its own timer/shell sizing.
 */
export function updateText(container: HTMLElement, text: string): void {
  let state = states.get(container);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = typeof container.animate === 'function' && !reducedMotion;
  if (state?.text === text && (canAnimate ? state.glyphs.length > 0 || text === '' : state.glyphs.length === 0)) return;
  const previous = state?.glyphs ?? [];
  const previousText = state?.text ?? '';
  const animateChanges = state !== undefined && previous.length > 0;
  if (state) cancelAnimations(state);
  else {
    state = { text, glyphs: [], animations: new Set(), originalLabel: container.getAttribute('aria-label') };
    states.set(container, state);
  }
  state.text = text;
  container.setAttribute('aria-label', text);
  if (!canAnimate) {
    state.glyphs = [];
    container.textContent = text;
    return;
  }
  const chars = characters(text);
  const retained = previous.filter(({ node }) => container.contains(node));
  // why: timer columns stay put: a zero changing columns should not jump sideways.
  const matching =
    /^\d+:\d{2}$/.test(text) && /^\d+:\d{2}$/.test(previousText)
      ? new Map(retained.flatMap((glyph, index) => (glyph.text === chars[index] ? [[index, glyph] as const] : [])))
      : shared(retained, chars);
  const entering: HTMLSpanElement[] = [];
  const glyphs = chars.map((char, index): Glyph => {
    const existing = matching.get(index);
    if (existing) return existing;
    const node = document.createElement('span');
    node.setAttribute('aria-hidden', 'true');
    node.style.display = 'inline-block';
    node.style.whiteSpace = 'pre';
    node.textContent = char;
    entering.push(node);
    return { text: char, node };
  });
  /* why: moving existing nodes retains identity without leaving outgoing glyphs in
     the layout. Fixed-width/tabular timer styles remain on the parent. */
  const words: HTMLSpanElement[] = [];
  let word: HTMLSpanElement | undefined;
  for (const glyph of glyphs) {
    if (/\s/u.test(glyph.text)) {
      word = undefined;
      words.push(glyph.node);
    } else {
      if (!word) {
        word = document.createElement('span');
        word.setAttribute('data-recorder-word', '');
        word.style.display = 'inline-block';
        word.style.whiteSpace = 'nowrap';
        words.push(word);
      }
      word.append(glyph.node);
    }
  }
  container.replaceChildren(...words);
  state.glyphs = glyphs;
  if (!animateChanges) return;
  for (const node of entering) {
    const animation = animate(
      [node],
      { opacity: [0, 1], transform: ['translateY(3px)', 'translateY(0)'] },
      {
        duration: 0.16,
        ease: [0.2, 0.7, 0.2, 1],
      },
    );
    state.animations.add(animation);
    const animations = state.animations;
    const release = () => animations.delete(animation);
    void animation.finished.then(release, release);
  }
}

/** Cancel in-flight motion and release glyph resources when the UI is removed. */
export function cleanupText(container: HTMLElement): void {
  const state = states.get(container);
  if (!state) return;
  cancelAnimations(state);
  container.textContent = state.text;
  if (state.originalLabel === null) container.removeAttribute('aria-label');
  else container.setAttribute('aria-label', state.originalLabel);
  states.delete(container);
}
