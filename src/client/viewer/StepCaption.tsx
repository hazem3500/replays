import { useSeekedPause } from '../hooks/use-seeked-pause.ts';
import { LiveCaption } from '../LiveCaption.tsx';
import { usePlayer, usePlayerState, usePlayhead } from '../player.ts';
import { captionAt, captionDisplayText } from '../step-caption.ts';
import { useActiveStep } from './active-step.ts';
import { useViewer } from './context.ts';
import { StepNameInput } from './StepNameInput.tsx';
import { useRenamingKey, useStepRenaming } from './step-rename-context.ts';

/**
 * Step captions: the current step's label as a calm caption on the player while it plays, and while you scrub or
 * seek (pointer drag, touch drag, keys, a step click) and stay paused there; a pause without a seek, or the end,
 * clears it. The stable caption host swaps the whole line between step labels, and sits at the edge the video
 * export puts it (caption-placement.ts), clear of the action.
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
  const edge = 'bottom';
  const renaming = useStepRenaming();
  const editingKey = useRenamingKey(renaming, 'caption');
  const key = renaming?.keys[captionIndex];
  const editing = Boolean(renaming && key && key === editingKey);
  const finish = (action: 'save' | 'cancel' | 'reset') => {
    if (!renaming) return;
    const resume = renaming.store.get()?.wasPlaying;
    renaming.finish(action);
    if (resume) player.play();
  };
  return (
    <LiveCaption
      text={active || editing ? captionDisplayText(step?.label ?? '') : undefined}
      number={number}
      edge={edge}
      testId="step-caption"
      {...(renaming?.allowed && key && step
        ? {
            onDoubleClick: () => {
              const wasPlaying = status === 'playing';
              player.pause();
              renaming.start(captionIndex, 'caption', step.label, wasPlaying);
            },
          }
        : {})}
      {...(editing && renaming ? { editor: <StepNameInput renaming={renaming} renamed={Boolean(key && key in renaming.names)} onFinish={finish} /> } : {})}
    />
  );
}
