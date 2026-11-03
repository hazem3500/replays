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

/** "0:03.2 → 0:01.9": the recording's length and what the edits leave (just the length when nothing is removed). */
export function Durations({ original, edited }: { original: number; edited: number }) {
  const changed = Math.round(edited) !== Math.round(original);
  return (
    <span
      className="editor-durations"
      role="group"
      data-testid="durations"
      aria-label={changed ? `${formatClock(original)} recorded, ${formatClock(edited)} edited` : `${formatClock(original)} recorded`}
    >
      <span className="editor-durations-original" data-changed={changed || undefined}>
        {formatClock(original)}
      </span>
      {changed ? (
        <>
          <span aria-hidden="true">→</span>
          <strong data-testid="edited-length">{formatClock(edited)}</strong>
          <span className="editor-durations-note" aria-hidden="true">
            after edits
          </span>
        </>
      ) : null}
    </span>
  );
}
