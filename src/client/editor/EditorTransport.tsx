import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { IconSwap } from '@/components/icon-swap.tsx';

import { formatClock } from '../../shared/replay.ts';
import { usePlayerState, usePlayhead } from '../player.ts';

/** Play or pause the edited result, with Space in its tooltip; shared by the desktop bar and the phone timeline. */
export function EditorPlayButton({ onSwitch }: { onSwitch: () => void }) {
  const { status } = usePlayerState();
  const label = status === 'playing' ? 'Pause' : 'Play the result';
  return (
    <IconButton
      label={label}
      shortcut="Space"
      tooltipAlign="start"
      className="play-button text-foreground"
      onClick={onSwitch}
      data-testid="editor-play"
    >
      <IconSwap state={status === 'playing' ? 'b' : 'a'}>
        <AnimatedIcon name="play" className="icon-a filled-icon" />
        <AnimatedIcon name="pause" className="icon-b filled-icon" />
      </IconSwap>
    </IconButton>
  );
}

/** The playhead on the original timeline. */
export function EditorClock() {
  const clock = usePlayhead((time) => formatClock(time));
  return (
    <span className="editor-clock" data-testid="editor-clock">
      {clock}
    </span>
  );
}

/** "0:04.0 / 0:13.5": where the playhead is and how long the recording runs, read as one timecode. */
export function EditorTime({ total }: { total: number }) {
  return (
    <span className="editor-time">
      <EditorClock />
      <span className="editor-time-total">/ {formatClock(total)}</span>
    </span>
  );
}
