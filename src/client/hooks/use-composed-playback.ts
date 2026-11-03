import { useEffect, useLayoutEffect, useState } from 'react';

import { NO_EFFECTS, type PlaybackEffects } from '../../shared/effects.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { ReplayController, type Playback } from '../playback/index.ts';

/** Owns a default controller across renders; an external playback remains the caller's responsibility. */
export function useComposedPlayback(bundle: ReplayBundle, external: Playback | undefined, effects: PlaybackEffects | undefined): Playback {
  const [owned, setOwned] = useState(() => ({ bundle, playback: new ReplayController(bundle, effects ? { effects } : {}) }));
  if (owned.bundle !== bundle) setOwned({ bundle, playback: new ReplayController(bundle, effects ? { effects } : {}) });
  const playback = external ?? owned.playback;
  useLayoutEffect(() => {
    if (!external) {
      playback.setEffects(effects ?? NO_EFFECTS);
      return;
    }
    if (effects === undefined) return;
    const baseline = playback.getEffects();
    playback.setEffects(effects);
    return () => playback.setEffects(baseline);
  }, [effects, external, playback]);
  useEffect(
    () => () => {
      if (!external) playback.pause();
    },
    [external, playback],
  );
  return playback;
}

/** Keeps the context identity unchanged until its recording or controller changes, including uncompiled consumers. */
export function useReplayCompositionValue(bundle: ReplayBundle, playback: Playback) {
  const [value, setValue] = useState({ bundle, playback });
  if (value.bundle !== bundle || value.playback !== playback) {
    const next = { bundle, playback };
    setValue(next);
    return next;
  }
  return value;
}
