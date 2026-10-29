import { useEffect } from 'react';
import type { Playback } from '../player.ts';
import { viewerRegistry } from '../plugins/registry.ts';

/** Playback lifecycle stays outside server render and detaches when a replay leaves the page. */
export function usePluginEvents(replayId: string, tab: string, player: Playback): void {
  useEffect(() => {
    const unsubscribe = player.subscribeSeek(() => {
      viewerRegistry.emitEvent({ type: 'seek', replayId, timeMs: player.getTime() });
    });
    const close = viewerRegistry.openReplay(replayId);
    return () => {
      unsubscribe();
      close();
    };
  }, [player, replayId]);
  useEffect(() => {
    viewerRegistry.emitEvent({ type: 'tab:change', replayId, tab });
  }, [replayId, tab]);
}
