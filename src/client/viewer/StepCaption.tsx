import { useSeekedPause } from '../hooks/use-seeked-pause.ts';
import { LiveCaption } from '../LiveCaption.tsx';
import { usePlayer, usePlayerState, usePlayhead } from '../player.ts';
import { captionAt, captionDisplayText } from '../step-caption.ts';
import { useActiveStep } from './active-step.ts';
import { useViewer } from './context.ts';

/**
 * Step captions: the current step's label as a calm caption on the player while it plays, and while you scrub or
 * seek (pointer drag, touch drag, keys, a step click) and stay paused there; a pause without a seek, or the end,
 * clears it. The stable caption host swaps the whole line between step labels.
 */
export function StepCaption() {
  const player = usePlayer();
  const { steps, captionNumbers } = useViewer();
  const { status } = usePlayerState();
  // why: the rail's own step index, so caption and rail never disagree at a boundary.
  const activeIndex = useActiveStep(steps);
  const seeked = useSeekedPause(player);
  const captionIndex = usePlayhead((time) => captionAt(steps, time, player.duration)?.index ?? -1);
  const step = steps[captionIndex];
  const active = Boolean(step && (status === 'playing' || (seeked && status !== 'ended')));
  const number = active && captionNumbers ? activeIndex + 1 : undefined;
  return <LiveCaption text={active ? captionDisplayText(step?.label ?? '') : undefined} number={number} testId="step-caption" />;
}
