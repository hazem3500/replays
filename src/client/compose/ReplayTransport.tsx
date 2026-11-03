import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { formatClock } from '../../shared/replay.ts';
import { SPEEDS, type PlayerState } from '../playback/index.ts';
import { positionText } from '../timeline.ts';
import { useReplay, useReplayState, useReplayTime, type ReplayContextValue } from './context.ts';

export interface ReplayTransportModel extends ReplayContextValue {
  time: number;
  state: PlayerState;
}

export interface ReplayTransportProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Replace the semantic default controls with any UI driven by this instance's clock and actions. */
  children?: (model: ReplayTransportModel) => ReactNode;
}

/** Unstyled native controls, or a render prop for the host's own control system. */
export function ReplayTransport({ children, ...props }: ReplayTransportProps) {
  const replay = useReplay();
  const state = useReplayState();
  const time = useReplayTime();
  const { playback } = replay;
  if (children) return children({ ...replay, time, state });
  return (
    <div role="group" aria-label="Playback" {...props}>
      <button type="button" onClick={playback.playPause}>
        {state.status === 'playing' ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        aria-label="Replay position"
        aria-valuetext={positionText(time, playback.duration)}
        min={0}
        max={playback.duration}
        step={1}
        value={time}
        onChange={(event) => playback.seek(event.currentTarget.valueAsNumber)}
        onPointerDown={playback.beginScrub}
        onPointerUp={playback.endScrub}
        onPointerCancel={playback.endScrub}
        onBlur={playback.endScrub}
      />
      <output>
        {formatClock(time)} / {formatClock(playback.duration)}
      </output>
      <label>
        Playback speed
        <select
          value={state.speed}
          onChange={(event) => {
            const speed = SPEEDS.find((candidate) => candidate === Number(event.currentTarget.value));
            if (speed !== undefined) playback.setSpeed(speed);
          }}
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
