import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { EASE, GLIDE_MS, LEAVE_MS, reducedMotion, STAGGER_MAX_MS, staggerDelay } from '../index/list-motion.ts';

/** Matches --skeleton-delay (loading.css): a skeleton replaced sooner was never seen. */
const SKELETON_DELAY_MS = 200;

/**
 * The hand-over from a pending feed to whatever arrives. While `loading`, it keeps the skeleton element it rendered
 * and the box's height; when loading ends after the skeleton was on screen, it shows a copy of that skeleton over the
 * content (`leaving`, mounted in `ghost`) whose items fade out on the cards' own stagger (list-motion.ts), and eases
 * the box from the skeleton's height down to the content's. A skeleton replaced before it appeared hands over with no
 * motion. Returns refs for the box and the copy, and the copy to render (null once it is gone).
 */
export function useFeedReveal(loading: boolean, skeleton: ReactNode) {
  const box = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const memory = useRef({ loading, since: 0, height: 0 });
  const [ghostAlive, setGhostAlive] = useState(loading);
  const shownSkeleton = useRef(skeleton);
  // oxlint-disable-next-line react/refs -- why: the copy must draw the skeleton this render showed, not a recount made after the list landed.
  if (loading) shownSkeleton.current = skeleton;

  useLayoutEffect(() => {
    const element = box.current;
    if (!loading || !element) return;
    const observer = new ResizeObserver(() => {
      memory.current.height = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  useLayoutEffect(() => {
    const state = memory.current;
    if (loading) {
      if (!state.loading || !state.since) state.since = performance.now();
      state.loading = true;
      return;
    }
    if (!state.loading) return;
    state.loading = false;
    const element = box.current;
    const seen = performance.now() - state.since >= SKELETON_DELAY_MS && !reducedMotion();
    if (seen && element && ghost.current) {
      ghost.current.style.setProperty('--leave-ms', `${LEAVE_MS}ms`);
      ghost.current.style.setProperty('--leave-ease', EASE);
      for (const [index, item] of ghost.current.querySelectorAll<HTMLElement>('.feed-item').entries())
        item.style.setProperty('--leave-delay', `${staggerDelay(index)}ms`);
      ghost.current.dataset.leaving = '';
      const from = state.height;
      const to = element.offsetHeight;
      // why: only a shrink is visible; a taller list grows past the fold.
      if (from - to > 2) element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: GLIDE_MS, easing: EASE });
    }
    const timer = window.setTimeout(() => setGhostAlive(false), seen ? LEAVE_MS + STAGGER_MAX_MS : 0);
    return () => window.clearTimeout(timer);
  }, [loading]);

  // oxlint-disable-next-line react/refs -- why: the element captured while loading, read only to render the leaving copy.
  const leaving = ghostAlive && !loading ? shownSkeleton.current : null;
  return { box, ghost, leaving };
}
