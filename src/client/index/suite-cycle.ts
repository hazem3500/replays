import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ReviewSuiteIndexRun } from '../../shared/review-suite.ts';
import { playableReplayId } from '../suite/runs.ts';
import { prefetchPreview } from './Poster.tsx';

/*
 * A suite card's hover preview cycles through its runs: each run's preview plays once, then the stack shuffles
 * (the front card slides back into the pile while the next run's card rises to the front) and the next run plays,
 * looping. The run strip marks the run on screen and the card opens at it. Leaving the card resets to the front run.
 * Only recorded runs take part; with fewer than two there is nothing to cycle and the preview simply loops.
 */

export interface SuiteCycle {
  /** The run on the front card now. */
  current: ReviewSuiteIndexRun | undefined;
  /** How many runs have been shown since the hover began (0: the suite's own front run). */
  step: number;
  /** Several runs to cycle through, and the preview is playing. */
  cycling: boolean;
  /** The front run's preview ended (or had none): shuffle to the next run. */
  advance: () => void;
  /** The front run's preview is past halfway: warm the next one. */
  warmNext: () => void;
}

export function useSuiteCycle(runs: readonly ReviewSuiteIndexRun[], front: ReviewSuiteIndexRun | undefined, playing: boolean): SuiteCycle {
  // Recorded runs in run order, starting at the suite's own front run (its failed run, when there is one).
  const order = useMemo(() => {
    const playable = [...runs].filter((run) => playableReplayId(run, true)).sort((a, b) => a.sequence - b.sequence);
    const start = front ? playable.indexOf(front) : -1;
    return start > 0 ? [...playable.slice(start), ...playable.slice(0, start)] : playable;
  }, [runs, front]);
  const [stored, setStep] = useState(0);
  // Leaving the card resets to the front run (derived during render, so the reset paints with the leave).
  const step = playing ? stored : 0;
  if (!playing && stored !== 0) setStep(0);
  const cycling = playing && order.length > 1;
  const current = cycling ? order[step % order.length] : front;
  const next = cycling ? order[(step + 1) % order.length] : undefined;
  const advance = useCallback(() => setStep((value) => value + 1), []);
  const warmNext = useCallback(() => {
    const id = next ? playableReplayId(next, true) : undefined;
    if (id) prefetchPreview(id);
  }, [next]);
  return { current, step, cycling, advance, warmNext };
}

const SHUFFLE_MS = 900;
const EASE = 'cubic-bezier(0.25, 0.1, 0.25, 1)';

/**
 * The outgoing sheet rises clear before fading into the rear while the next sheet advances after a short hold.
 * Transform/opacity only; under reduced
 * motion the new front just fades in.
 */
export function useShuffle(container: React.RefObject<HTMLElement | null>, step: number) {
  const previous = useRef(step);
  const outgoing = useRef<HTMLElement | undefined>(undefined);
  /** Call before the step changes: keeps a still of the current front for the slide-back. */
  const capture = () => {
    const poster = container.current?.querySelector<HTMLElement>(
      ':scope > .poster, :scope[data-view=grid] > .suite-sheet, .stack-front > .poster',
    );
    const image = poster?.querySelector<HTMLImageElement>('img');
    if (!poster || (!image && !poster.classList.contains('suite-sheet'))) return;
    const still = poster.cloneNode(true) as HTMLElement;
    still.inert = true;
    still.querySelectorAll('video').forEach((video) => video.remove());
    still.setAttribute('aria-hidden', 'true');
    still.classList.add(poster.classList.contains('suite-sheet') ? 'suite-sheet-outgoing' : 'poster-outgoing');
    still.style.zIndex = '3';
    still.style.setProperty('position', 'absolute');
    still.style.setProperty('left', `${poster.offsetLeft}px`);
    still.style.setProperty('top', `${poster.offsetTop}px`);
    still.style.setProperty('width', `${poster.offsetWidth}px`);
    still.style.setProperty('height', `${poster.offsetHeight}px`);
    outgoing.current?.remove();
    outgoing.current = still;
  };

  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = step;
    const still = outgoing.current;
    outgoing.current = undefined;
    const poster = container.current?.querySelector<HTMLElement>(
      ':scope > .poster, :scope[data-view=grid] > .suite-sheet, .stack-front > .poster',
    );
    if (!poster || step <= was) {
      still?.remove();
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still && !reduced) {
      // why: keep the outgoing sheet above the incoming one until it clears the stack.
      poster.before(still);
      container.current?.querySelectorAll<HTMLElement>('.card-back').forEach((back) =>
        back.animate([{ transform: 'translateY(-24px) scale(0.86)' }, { transform: getComputedStyle(back).transform }], {
          duration: SHUFFLE_MS,
          easing: EASE,
        }),
      );
      poster.style.zIndex = '1';
      void still
        .animate(
          [
            { transform: 'translateY(0) scale(1)', opacity: 1 },
            { transform: 'translateY(-30px) scale(0.98)', opacity: 1, offset: 0.35 },
            {
              transform: 'translateY(-30px) scale(0.95)',
              opacity: 1,
              offset: 0.5,
              zIndex: 0,
            },
            {
              transform: 'translateY(-11px) rotate(1.25deg) scale(0.9)',
              opacity: 1,
              offset: 0.9,
              zIndex: 0,
            },
            { transform: 'translateY(-11px) rotate(1.25deg) scale(0.9)', opacity: 0, zIndex: 0 },
          ],
          { duration: SHUFFLE_MS, easing: EASE, fill: 'forwards' },
        )
        .finished.catch(() => undefined)
        .finally(() => still.remove());
    } else still?.remove();
    const incoming = poster.animate(
      reduced
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [
            { transform: 'translateY(-10px) scale(0.95)', opacity: 1, offset: 0 },
            { transform: 'translateY(-10px) scale(0.95)', opacity: 1, offset: 0.25 },
            { transform: 'translateY(0) scale(1)', opacity: 1 },
          ],
      { duration: reduced ? 120 : SHUFFLE_MS, easing: EASE },
    );
    return () => {
      incoming.cancel();
      container.current?.querySelectorAll('.card-back').forEach((back) => back.getAnimations().forEach((animation) => animation.cancel()));
      poster.style.removeProperty('z-index');
      still?.getAnimations().forEach((animation) => animation.cancel());
      still?.remove();
    };
  }, [container, step]);

  return capture;
}
