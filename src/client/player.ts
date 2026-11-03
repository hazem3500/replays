// oxlint-disable-next-line import/no-unassigned-import -- why: the application opts into renderer styles; public hosts import their own stylesheet entry.
import './playback/playback.css';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Playback } from './playback/types.ts';

export { ReplayController, eventSpan } from './playback/controller.ts';
export { SPEEDS, type Speed, type PlaybackStatus, type PlayerState, type Viewport, type Playback } from './playback/types.ts';

export const PlayerContext = createContext<Playback | null>(null);

export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerContext provider');
  return player;
}

/**
 * Subscribes to the playhead. Pass a selector that returns a primitive (an
 * index, a count) so the component re-renders only when that value changes.
 */
export function usePlayhead(): number;
export function usePlayhead<T>(select: (time: number) => T): T;
export function usePlayhead<T>(select?: (time: number) => T) {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeTime, () => (select ? select(player.getTime()) : player.getTime()));
}

export function usePlayerState() {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeState, player.getState);
}

export function useViewport() {
  const player = usePlayer();
  return useSyncExternalStore(player.subscribeViewport, player.getViewport);
}
