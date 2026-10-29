import { useSyncExternalStore } from 'react';

import type { Playback } from '../player.ts';

/**
 * A quiet view (Walkthrough) lets the top bar fade while the replay plays: true while it plays in such a view. Other
 * views read false, so play and pause never re-render them.
 */
export function useQuietPlaying(player: Playback, enabled: boolean) {
  return useSyncExternalStore(
    player.subscribeState,
    () => enabled && player.getState().status === 'playing',
    () => false,
  );
}
