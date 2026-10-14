import { usePlayer, usePlayhead } from '../player.ts';
import { activeStepIndex } from '../timeline.ts';

/**
 * The step at the playhead: the one source the step rail (list, highlight, "n of N") and the player's caption read,
 * so they can never disagree at a step boundary.
 */
export function useActiveStep(steps: ReadonlyArray<{ at: number }>) {
  const player = usePlayer();
  return usePlayhead((time) => activeStepIndex(steps, time, player.duration));
}
