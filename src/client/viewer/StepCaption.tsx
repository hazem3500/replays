import type { ReplayStep } from '../../shared/replay.ts';
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
 * clears it. The stable caption host swaps the whole line between step labels.
 *
 * `recording` captions another recording on the same clock (a compared tile that is not in focus) with its own steps;
 * only the viewer's own recording can be renamed from its caption.
 */
export function StepCaption({ recording }: { recording?: { steps: readonly ReplayStep[]; duration: number } }) {
  const player = usePlayer();
  const viewer = useViewer();
  const steps = recording?.steps ?? viewer.steps;
  const duration = recording?.duration ?? player.duration;
  const { status } = usePlayerState();
  // why: the rail's own step index, so caption and rail never disagree at a boundary.
  const activeIndex = useActiveStep(steps, duration);
  const seeked = useSeekedPause(player);
  const captionIndex = usePlayhead((time) => captionAt(steps, time, duration)?.index ?? -1);
  const step = steps[captionIndex];
  const active = Boolean(step && (status === 'playing' || (seeked && status !== 'ended')));
  const number = active && viewer.captionNumbers ? activeIndex + 1 : undefined;
  const viewerRenaming = useStepRenaming();
  const renaming = recording ? null : viewerRenaming;
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
      {...(editing && renaming
        ? { editor: <StepNameInput renaming={renaming} renamed={Boolean(key && key in renaming.names)} onFinish={finish} /> }
        : {})}
    />
  );
}
