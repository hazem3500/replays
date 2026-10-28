/**
 * The index list's motion, in one place: the numbers every feed motion shares, so items entering on first load
 * (feed-transition.ts staggerIn), on a filter, search or sort change (feed-transition.ts feedTransition), when
 * scrolled into view (hooks/use-scroll-reveal.ts), and the skeleton leaving under them (FeedSkeleton.tsx) all move
 * alike. list-motion.css mirrors the durations for the View Transition pseudo-elements.
 *
 * - Entering: fade in and rise ENTER_RISE_PX, ENTER_MS, items STAGGER_MS apart, the last starting at most
 *   STAGGER_MAX_MS after the first (later ones start together), in-viewport items only.
 * - Leaving: fade out, LEAVE_MS, no slide.
 * - Staying: glide to the new place (and morph between list and grid), GLIDE_MS.
 * One strong ease-out (EASE = --ease-out), no overshoot: rows and cards change size by hundreds of pixels.
 */
export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const ENTER_MS = 240;
export const ENTER_RISE_PX = 8;
export const LEAVE_MS = 120;
export const GLIDE_MS = 280;
export const STAGGER_MS = 25;
export const STAGGER_MAX_MS = 150;
/** List ↔ grid: the items that stay start a little apart too, in visual order. */
export const MORPH_STAGGER_MS = 8;
export const MORPH_STAGGER_MAX_MS = 60;

/** The n-th entering item's delay (0-based). */
export const staggerDelay = (index: number, step = STAGGER_MS, max = STAGGER_MAX_MS) => Math.min(index * step, max);

/** The entrance as keyframes (WAAPI): first load and scroll reveal. */
export const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: `translate3d(0, ${ENTER_RISE_PX}px, 0)` },
  { opacity: 1, transform: 'none' },
];

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
