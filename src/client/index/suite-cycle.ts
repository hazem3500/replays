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

const DROP_MS = 220;
const RETURN_MS = 300;
const EASE = 'cubic-bezier(0.25, 0.1, 0.25, 1)';

/**
 * The outgoing sheet slides down as its successor advances, then returns upward behind the new front.
 * Reduced motion replaces the shuffle with a short fade.
 */
export function useShuffle(container: React.RefObject<HTMLElement | null>, step: number, view?: string) {
  const previous = useRef(step);
  const outgoing = useRef<HTMLElement | undefined>(undefined);
  /** Call before the step changes: keeps a still of the current front for the slide-back. */
  const capture = () => {
    const candidates = container.current?.querySelectorAll<HTMLElement>(
      ':scope > .poster, :scope[data-view=grid] > .suite-sheet, .stack-front > .poster',
    );
    const poster = candidates && [...candidates].find((candidate) => !candidate.closest('.suite-sheet-outgoing, .poster-outgoing'));
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
    const element = container.current;
    const was = previous.current;
    previous.current = step;
    const still = outgoing.current;
    outgoing.current = undefined;
    const candidates = element?.querySelectorAll<HTMLElement>(
      view === 'grid' ? ':scope > .suite-sheet' : ':scope > .poster, .stack-front > .poster',
    );
    const poster = candidates && [...candidates].find((candidate) => !candidate.closest('.suite-sheet-outgoing, .poster-outgoing'));
    if (!poster || step <= was) {
      still?.remove();
      return;
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations: Animation[] = [];
    let active = true;
    const animate = (target: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = target.animate(frames, options);
      animations.push(animation);
      return animation;
    };
    if (still && !reduced) {
      poster.before(still);
      poster.style.zIndex = '2';
      const dropped = 'translateY(42px) scale(0.98)';
      const down = animate(still, [{ transform: 'translateY(0) scale(1)' }, { transform: dropped }], {
        duration: DROP_MS,
        easing: EASE,
        fill: 'forwards',
      });
      void down.finished
        .then(() => {
          if (!active) return;
          // why: change stacking only at the turn, so the old face returns beneath its successor.
          still.style.zIndex = '1';
          const rear = animate(
            still,
            [
              { transform: dropped, opacity: 1 },
              { transform: 'translateY(-11px) rotate(1.25deg) scale(0.9)', opacity: 1, offset: 0.85 },
              { transform: 'translateY(-11px) rotate(1.25deg) scale(0.9)', opacity: 0 },
            ],
            { duration: RETURN_MS, easing: EASE, fill: 'forwards' },
          );
          down.cancel();
          return rear.finished;
        })
        .catch(() => undefined)
        .finally(() => still.remove());
    } else still?.remove();
    animate(
      poster,
      reduced
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [{ transform: 'translateY(-10px) scale(0.95)' }, { transform: 'translateY(0) scale(1)' }],
      { duration: reduced ? 120 : 280, delay: reduced ? 0 : 60, easing: EASE, fill: 'backwards' },
    );
    return () => {
      active = false;
      for (const animation of animations) animation.cancel();
      poster.style.removeProperty('z-index');
      still?.remove();
    };
  }, [container, step, view]);

  return capture;
}
