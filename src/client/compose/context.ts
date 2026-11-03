import { createContext, use, useSyncExternalStore } from 'react';

import type { ReplayBundle } from '../../shared/replay.ts';
import type { Playback } from '../playback/index.ts';

/** One provider's recording and playback. Supply an external playback to control it outside React. */
export interface ReplayContextValue {
  bundle: ReplayBundle;
  playback: Playback;
}

export const ReplayCompositionContext = createContext<ReplayContextValue | null>(null);

/** Reads the nearest independent replay instance without router, query or application settings providers. */
export function useReplay(): ReplayContextValue {
  const value = use(ReplayCompositionContext);
  if (!value) throw new Error('Replay composition needs a ReplayProvider');
  return value;
}

// invariant: selectors return a primitive or stable value so external-store snapshots can retain their identity.
export function useReplayTime(): number;
export function useReplayTime<T>(select: (time: number) => T): T;
export function useReplayTime<T>(select?: (time: number) => T): T | number {
  const { playback } = useReplay();
  const snapshot = () => (select ? select(playback.getTime()) : playback.getTime());
  return useSyncExternalStore(playback.subscribeTime, snapshot, snapshot);
}

/** Subscribes to playback status, speed and idle skipping independently of frame updates. */
export function useReplayState() {
  const { playback } = useReplay();
  return useSyncExternalStore(playback.subscribeState, playback.getState, playback.getState);
}

/** Subscribes to recorded viewport changes, including navigation to a differently sized document. */
export function useReplayViewport() {
  const { playback } = useReplay();
  return useSyncExternalStore(playback.subscribeViewport, playback.getViewport, playback.getViewport);
}
