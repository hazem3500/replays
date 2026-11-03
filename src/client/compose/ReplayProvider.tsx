import type { ReactNode } from 'react';

import type { PlaybackEffects } from '../../shared/effects.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { useComposedPlayback, useReplayCompositionValue } from '../hooks/use-composed-playback.ts';
import type { Playback } from '../playback/index.ts';
import { ReplayCompositionContext } from './context.ts';

export interface ReplayProviderProps {
  bundle: ReplayBundle;
  /**
   * Optional public ReplayController or compatible Playback, owned by the caller. This lower-level engine differs
   * from the createReplayPlayback service, which owns its own loading and mount lifecycle. Its bundle must match.
   */
  playback?: Playback;
  /** Optional playback-only effects; capture privacy and the stored recording remain unchanged. */
  effects?: PlaybackEffects;
  children: ReactNode;
}

/** Composes a recording's independently placed stage, controls and diagnostic UI without the application shell. */
export function ReplayProvider({ bundle, playback: external, effects, children }: ReplayProviderProps) {
  const playback = useComposedPlayback(bundle, external, effects);
  const value = useReplayCompositionValue(bundle, playback);
  return <ReplayCompositionContext value={value}>{children}</ReplayCompositionContext>;
}
