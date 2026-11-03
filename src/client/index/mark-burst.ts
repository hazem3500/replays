import { cancelFrame, frame as motionFrame } from 'motion';
import { cancelMarkAnimations, markAnimate, type MarkAnimation } from './mark-animation.ts';

/*
 * The product mark (components/brand-mark.tsx ProductMark, IndexHeader.tsx MarkButton): a line of five timeline segments with an accent-coloured
 * playhead. Each click "scrubs" one segment forward; 1.5 s after the last click it drains back to rest. Rapid
 * clicks build a streak; the fifth within the window plays the "reverse typewriter": the playhead leaves the mark as a
 * text caret, glides across the product name to its end, backspaces it right to left (faster and faster, like a held key) while the segments drain, types
 * it back in while they refill, blinks once and docks back into the mark at rest. Then a cooldown so a streak cannot
 * re-trigger it. Reduced motion: clicks still fill segments, as plain state changes (no pop, spring or nod); the burst
 * only crossfades the title.
 */

/** Clicks closer together than this belong to one streak. */
export const STREAK_GAP_MS = 1500;
/** The click that sets off the burst. */
export const BURST_AT = 5;
/** After a burst, streaks keep scrubbing the mark but cannot burst again for this long. */
export const COOLDOWN_MS = 4000;

/** The mark's five segments on its 24-unit grid: [x, width]; y 10, height 4.2, fully rounded. */
export const SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [3, 3.6],
  [7.6, 2.6],
  [11.2, 3.8],
  [16, 2.2],
  [19.2, 1.8],
];
/** At rest two segments are filled and the playhead sits after the second. */
export const REST_FILLED = 2;

/** Where the playhead stands after segment `index` (-1: before the first). */
export function playheadX(index: number) {
  return index < 0 ? SEGMENTS[0]![0] - 0.2 : SEGMENTS[index]![0] + SEGMENTS[index]![1] + 0.5;
}

/** One click on a scrubbed mark: the next segment fills, or (all full) the playhead nods. */
export function scrub(filled: number) {
  return filled < SEGMENTS.length ? { filled: filled + 1, fills: filled, nod: false } : { filled, fills: undefined, nod: true };
}

export interface StreakStep {
  /** 1-based position in the current streak. */
  count: number;
  burst: boolean;
}

/** Streak bookkeeping, pure apart from the clock (injectable for tests). */
export function createStreak(now: () => number = () => performance.now()) {
  let count = 0;
  let last = Number.NEGATIVE_INFINITY;
  let cooldownUntil = Number.NEGATIVE_INFINITY;
  return {
    click(): StreakStep {
      const time = now();
      count = time - last > STREAK_GAP_MS ? 1 : count + 1;
      last = time;
      const burst = count >= BURST_AT && time >= cooldownUntil;
      if (burst) {
        cooldownUntil = time + COOLDOWN_MS;
        const step = { count, burst };
        count = 0;
        return step;
      }
      return { count, burst };
    },
  };
}

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** A spring with a small overshoot (~8 %), for the playhead landing. */
export const SPRING = 'spring';
/** A gentler spring (~2 % overshoot) for the caret's long trip home: ~1 px past at 20 px type, then settled. */
const DOCK = 'dock';
/** The caret's run across the word to its end: eases in and out, so it is seen travelling over the letters. */
const GLIDE = 'cubic-bezier(0.65, 0, 0.35, 1)';
/** How long that run takes, and the beat at the end before the first backspace. */
export const GLIDE_MS = 380;
const GLIDE_PAUSE_MS = 90;

/** The pause after each backspace, shortening like a held key's auto-repeat (one per letter, right to left). */
export const BACKSPACE_GAPS_MS = [70, 56, 46, 40, 36, 33, 30];
/** Typing the word back in: one letter per step. */
export const TYPE_STEP_MS = 100;

/** Segments still lit while the word is being deleted: drains in step from `from` to 0 as `left` letters remain. */
export function drainedFill(left: number, letters: number, from: number) {
  return letters <= 0 ? 0 : Math.floor((from * Math.max(0, left)) / letters);
}
/** Segments lit once `typed` of `letters` letters are back: all five as the word completes. */
export function typedFill(typed: number, letters: number) {
  return letters <= 0 ? SEGMENTS.length : Math.min(SEGMENTS.length, Math.floor((SEGMENTS.length * typed) / letters));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reduced motion's whole burst: the word only crossfades. */
export function crossfadeTitle(title: HTMLElement) {
  return markAnimate(title, [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
}

/** Animates `element` to `transform` from what is on screen (cancelling its running transform animation). */
function tween(element: HTMLElement, transform: string, duration: number, easing: string) {
  const from = getComputedStyle(element).transform;
  cancelMarkAnimations(element);
  element.style.transform = transform;
  return markAnimate(element, [{ transform: from === 'none' ? 'none' : from }, { transform }], { duration, easing });
}

/** The playhead's on-screen x (user units), read from its live transform so a retarget never jumps. */
function liveX(element: Element) {
  const transform = getComputedStyle(element).transform;
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).e : 0;
}

/**
 * Drives one rendered mark (Motion on its SVG parts; transform-box: fill-box in feed.css). Mirrors the
 * filled count on `svg[data-filled]` (tests read it). Every move starts from what is on screen, so rapid clicks
 * never jump or stack; `dispose()` cancels everything (unmount).
 */
export function createMarkMotion(svg: SVGSVGElement) {
  const segments = [...svg.querySelectorAll<SVGRectElement>('.mark-seg')];
  const playhead = svg.querySelector<SVGGElement>('.mark-playhead');
  const timers = new Set<number>();
  let filled = REST_FILLED;
  let idle: number | undefined;
  let busy = false;
  let disposed = false;
  let move: MarkAnimation | undefined;
  let x = playheadX(REST_FILLED - 1);
  // why: under reduced motion (set by the latest step) the same states are reached without movement.
  let still = false;
  /** Removes the burst's caret and title overlay (set while a burst runs). */
  let cleanup: (() => void) | undefined;

  const later = (ms: number, run: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      run();
    }, ms);
    timers.add(id);
  };
  const clearLater = () => {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
  const paint = (index: number, on: boolean) => {
    const segment = segments[index];
    if (!segment) return;
    if (on) segment.dataset.on = '';
    else delete segment.dataset.on;
  };
  const setFilled = (next: number) => {
    filled = next;
    svg.dataset.filled = String(filled);
  };
  /** Moves the playhead to `to`, from where it is on screen; `nod` tips it back and forth on the way. */
  const moveTo = (to: number, duration: number, easing: string, nod = false) => {
    if (!playhead) return;
    const from = move?.playState === 'running' ? liveX(playhead) : x;
    move?.cancel();
    x = to;
    playhead.style.transform = `translateX(${to}px)`;
    if (still) return;
    move = markAnimate(
      playhead,
      nod
        ? [
            { transform: `translateX(${from}px) rotate(0deg)` },
            { transform: `translateX(${to}px) rotate(-12deg)`, offset: 0.45 },
            { transform: `translateX(${to}px) rotate(0deg)` },
          ]
        : [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration, easing },
    );
  };
  const pop = (index: number) => {
    const segment = segments[index];
    return still || !segment
      ? undefined
      : markAnimate(segment, [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.12, 1.7)' }, { transform: 'scale(1, 1)' }], {
          duration: 360,
          easing: EASE,
        });
  };
  /** Streak over: extra segments drain right to left while the playhead glides back to rest. */
  const settle = () => {
    const from = filled;
    for (let index = from - 1; index >= REST_FILLED; index--) later(still ? 0 : (from - 1 - index) * 50, () => paint(index, false));
    setFilled(REST_FILLED);
    moveTo(playheadX(REST_FILLED - 1), 520, EASE);
  };

  return {
    /**
     * One scrub click: the next segment fills with a pop and the playhead springs to its end (or nods). `stillMotion`
     * (reduced motion): the segment just fills and the playhead stands at its end, with no pop, spring or nod.
     */
    step(stillMotion = false) {
      if (busy || disposed) return;
      still = stillMotion;
      window.clearTimeout(idle);
      // A drain still in flight snaps to the logical state before the next segment fills.
      clearLater();
      segments.forEach((_, index) => paint(index, index < filled));
      const next = scrub(filled);
      if (next.fills === undefined) moveTo(x, 320, EASE, true);
      else {
        paint(next.fills, true);
        pop(next.fills);
        setFilled(next.filled);
        moveTo(playheadX(next.fills), 420, SPRING);
      }
      idle = window.setTimeout(settle, STREAK_GAP_MS);
    },
    /**
     * The fifth rapid click, the reverse typewriter (~2.8 s). The playhead leaves the mark as a tall text caret (an
     * aria-hidden twin in the identity row), glides across the title to its end and backspaces it, then types it back in
     * and docks home. The letters play on an aria-hidden overlay; the h1 keeps its text (transparent), so its
     * name and layout never change.
     */
    async burst(title: HTMLElement | null | undefined) {
      const host = title?.parentElement;
      if (busy || disposed || !title || !host || title.dataset.rewinding !== undefined) return;
      busy = true;
      still = false;
      window.clearTimeout(idle);
      clearLater();
      move?.cancel();
      segments.forEach((_, index) => paint(index, index < filled));
      const start = filled;

      // The overlay: one span per letter, each placed exactly where the h1 draws that letter (kerning included),
      // so handing back to the real text at the end moves nothing.
      const overlay = document.createElement('span');
      overlay.className = 'title-type';
      overlay.setAttribute('aria-hidden', 'true');
      const text = document.createTreeWalker(title, NodeFilter.SHOW_TEXT).nextNode();
      const titleBox = title.getBoundingClientRect();
      const range = document.createRange();
      const glyphs = [...(text?.textContent ?? '')].map((char, index) => {
        const glyph = document.createElement('span');
        glyph.textContent = char;
        if (text) {
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          glyph.style.left = `${range.getBoundingClientRect().left - titleBox.left}px`;
        }
        overlay.append(glyph);
        return glyph;
      });
      title.append(overlay);
      title.dataset.rewinding = '';
      // The caret: the playhead's HTML twin, in the mark's own units (the SVG is 24 units wide).
      const caret = document.createElement('span');
      caret.className = 'mark-caret';
      caret.setAttribute('aria-hidden', 'true');
      const stem = document.createElement('span');
      stem.className = 'mark-caret-stem';
      const head = document.createElement('span');
      head.className = 'mark-caret-head';
      caret.append(stem, head);
      host.append(caret);
      const hostBox = host.getBoundingClientRect();
      const markBox = svg.getBoundingClientRect();
      const unit = markBox.width / 24 || 1;
      caret.style.left = `${markBox.left - hostBox.left}px`;
      caret.style.top = `${markBox.top - hostBox.top}px`;
      const letters = glyphs.map((glyph) => {
        const box = glyph.getBoundingClientRect();
        return { glyph, x: (box.left - markBox.left) / unit, w: box.width / unit };
      });
      const at = (to: number) => `scale(${unit}) translateX(${to}px)`;
      const caretTo = (to: number, duration: number, easing: string) => tween(caret, at(to), duration, easing);
      const shape = (tall: boolean, duration: number) => {
        // Tall: a caret spanning the cap height (units 3 → 21) with a smaller head; short: exactly the playhead.
        tween(stem, tall ? 'translateY(3.2px) scaleY(1.607)' : 'translateY(0px) scaleY(1)', duration, EASE);
        tween(head, tall ? 'translateY(-3.6px) scale(0.7)' : 'translateY(0px) scale(1)', duration, EASE);
      };
      const finish = () => {
        cancelMarkAnimations(caret, true);
        cancelMarkAnimations(overlay, true);
        caret.remove();
        overlay.remove();
        delete title.dataset.rewinding;
        if (playhead) playhead.style.opacity = '';
      };
      cleanup = finish;
      try {
        const first = letters[0];
        const end = letters.at(-1);
        if (!first || !end) return;
        caret.style.transform = at(x);
        if (playhead) playhead.style.opacity = '0';

        // 1. Backspace: across the word to its end (seen passing over the letters), a beat, then delete right to
        // left, faster and faster.
        shape(true, 140);
        await caretTo(end.x + end.w + 1, GLIDE_MS, GLIDE).finished;
        await wait(GLIDE_PAUSE_MS);
        for (let index = letters.length - 1, step = 0; index >= 0; index--, step++) {
          if (disposed) return;
          const letter = letters[index]!;
          markAnimate(
            letter.glyph,
            [
              { opacity: 1, transform: 'scale(1)' },
              { opacity: 0, transform: 'scale(0.55)' },
            ],
            { duration: 80, easing: 'ease-in', fill: 'forwards' },
          );
          // Back one slot with a hair of overshoot, settling on the slot's edge.
          const gap = BACKSPACE_GAPS_MS[step] ?? 30;
          const from = getComputedStyle(caret).transform;
          cancelMarkAnimations(caret);
          caret.style.transform = at(letter.x + 0.2);
          markAnimate(caret, [{ transform: from }, { transform: at(letter.x - 0.6), offset: 0.7 }, { transform: at(letter.x + 0.2) }], {
            duration: Math.min(60, gap),
            easing: 'ease-out',
          });
          const lit = drainedFill(index, letters.length, start);
          for (let segment = lit; segment < SEGMENTS.length; segment++) paint(segment, false);
          setFilled(lit);
          await wait(gap);
        }
        await wait(200);
        if (disposed) return;

        // 2. Type it back in: the caret rides the end of the text and the segments fill with the word.
        for (const [index, letter] of letters.entries()) {
          if (disposed) return;
          cancelMarkAnimations(letter.glyph);
          letter.glyph.style.opacity = '1';
          letter.glyph.style.transform = 'none';
          caretTo(letter.x + letter.w + 1, 90, EASE);
          const lit = typedFill(index + 1, letters.length);
          for (let segment = filled; segment < lit; segment++) {
            paint(segment, true);
            pop(segment);
          }
          setFilled(Math.max(filled, lit));
          await wait(TYPE_STEP_MS);
        }

        // 3. One blink, then home: shrink back into the playhead and ride over the mark to rest, draining the extras.
        await markAnimate(caret, [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: 440, easing: 'step-end' })
          .finished;
        if (disposed) return;
        shape(false, 320);
        const homing = caretTo(playheadX(REST_FILLED - 1), 520, DOCK);
        const drain = () => {
          const position = new DOMMatrixReadOnly(getComputedStyle(caret).transform).e / unit;
          for (let segment = REST_FILLED; segment < SEGMENTS.length; segment++) {
            const [left, width] = SEGMENTS[segment]!;
            if (position < left + width / 2) paint(segment, false);
          }
        };
        motionFrame.update(drain, true);
        await homing.finished.catch(() => undefined);
        cancelFrame(drain);
        for (let segment = REST_FILLED; segment < SEGMENTS.length; segment++) paint(segment, false);
        setFilled(REST_FILLED);
        x = playheadX(REST_FILLED - 1);
        if (playhead) playhead.style.transform = `translateX(${x}px)`;
      } finally {
        if (!disposed) {
          finish();
          cleanup = undefined;
          busy = false;
        }
      }
    },
    dispose() {
      disposed = true;
      window.clearTimeout(idle);
      clearLater();
      cleanup?.();
      cancelMarkAnimations(svg, true);
    },
  };
}
