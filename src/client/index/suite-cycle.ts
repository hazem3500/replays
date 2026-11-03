import { useCallback, useMemo, useState } from 'react';

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
