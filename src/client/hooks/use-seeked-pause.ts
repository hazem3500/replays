import { useEffect, useState } from 'react';

import type { Playback } from '../player.ts';

/** True from a seek (drag, keys, a step click) until playback plays or ends: a pause that came from moving the playhead. */
export function useSeekedPause(player: Playback) {
  const [seeked, setSeeked] = useState(false);
  useEffect(() => {
    const offSeek = player.subscribeSeek(() => setSeeked(true));
    const offState = player.subscribeState(() => {
      const next = player.getState().status;
      if (next === 'playing' || next === 'ended') setSeeked(false);
    });
    return () => {
      offSeek();
      offState();
    };
  }, [player]);
  return seeked;
}
