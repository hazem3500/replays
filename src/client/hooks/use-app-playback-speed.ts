import { useLayoutEffect } from 'react';

import type { Playback, Speed } from '../playback/types.ts';
import { appPlaybackSpeed } from '../viewer/playback-speeds.ts';

/** Normalizes legacy app preferences without restricting the standalone playback engine. */
export function useAppPlaybackSpeed(player: Playback, speed: Speed) {
  const offered = appPlaybackSpeed(speed);
  useLayoutEffect(() => {
    if (speed !== offered) player.setSpeed(offered);
  }, [player, speed, offered]);
  return offered;
}
