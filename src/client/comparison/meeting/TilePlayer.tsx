import { useState } from 'react';

import type { ReplayBundle } from '../../../shared/replay.ts';
import { useReplayTile } from '../../hooks/use-replay-tile.ts';
import type { Fidelity, MeetingClock } from './clock.ts';

export const PLAYER_STRINGS = {
  failed: (reason: string) => `Recorded page unavailable: ${reason}`,
  retry: 'Retry',
  stage: (label: string) => `${label}: recorded page at the shared playhead`,
} as const;

/** One tile's rrweb player on the shared clock; a mount failure stays inside the tile with a retry. */
export function TilePlayer({
  id,
  bundle,
  clock,
  offset,
  fidelity,
  label,
}: {
  id: string;
  bundle: ReplayBundle;
  clock: MeetingClock;
  offset: number;
  fidelity: Fidelity;
  label: string;
}) {
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { stage, visibility } = useReplayTile({ id, bundle, clock, offset, fidelity, attempt, onFailure: setFailure });

  return (
    <div ref={visibility} className="mt-player" data-fidelity={fidelity}>
      {failure ? (
        <div className="mt-player-failure" role="alert">
          <p>{PLAYER_STRINGS.failed(failure)}</p>
          <button
            type="button"
            onClick={() => {
              setFailure('');
              setAttempt((value) => value + 1);
            }}
          >
            {PLAYER_STRINGS.retry}
          </button>
        </div>
      ) : (
        <div ref={stage} className="mt-stage" role="img" aria-label={PLAYER_STRINGS.stage(label)}>
          <div className="mt-host" inert />
        </div>
      )}
    </div>
  );
}
