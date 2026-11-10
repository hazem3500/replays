import { useEffect, useSyncExternalStore } from 'react';

import type { Playback } from '../playback/types.ts';
import { shortcutFor } from '../shortcuts.ts';
import type { IntentPlayer, PlayIntent } from '../suite/play-intent.ts';

const holdsPlay = (player: Playback): player is Playback & IntentPlayer => 'setPlayHold' in player;

/**
 * A suite run's viewer joins the workspace's play intent: it announces itself (so a switch away can carry "was
 * playing" and hold play presses meanwhile) and starts playing at once when this run is the one waiting to play.
 */
export function useRunPlayIntent(intent: PlayIntent | undefined, run: string, player: Playback) {
  useEffect(() => {
    if (!intent || !holdsPlay(player)) return;
    const detach = intent.attach(run, player);
    if (intent.take(run)) player.play();
    return detach;
  }, [intent, run, player]);
}

/** The run waiting to play (what the loading stand-in's play button shows), or undefined. */
export function useWantedRun(intent: PlayIntent) {
  return useSyncExternalStore(intent.subscribe, intent.getWanted);
}

/**
 * While `run`'s viewer is not up (its skeleton shows) Space and K ask for play the way its play button does, since no
 * viewer is there to hear them; a run that failed to load drops the request.
 */
export function useLoadingPlayKeys(intent: PlayIntent, run: string | undefined, state: 'loading' | 'failed' | 'ready') {
  useEffect(() => {
    if (state === 'failed') intent.cancel();
  }, [intent, state]);
  useEffect(() => {
    if (!run || state !== 'loading') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if (shortcutFor(event, event.target instanceof HTMLElement ? event.target : null) !== 'play-pause') return;
      event.preventDefault();
      if (intent.getWanted() === run) intent.cancel();
      else intent.request(run);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [intent, run, state]);
}
