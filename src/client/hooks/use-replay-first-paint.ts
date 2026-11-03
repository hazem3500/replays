import { useEffect, useState, type RefObject } from 'react';

import type { Playback } from '../playback/types.ts';
import { afterPageTransition, swappingInPlace } from '../transitions/state.ts';
import { waitForReplayPaint } from './replay-first-paint.ts';

type MountablePlayback = Pick<Playback, 'mount'>;

/** Defers expensive mounting until the route lands, then releases the cover when the rebuilt document is ready. */
export function useReplayFirstPaint(host: RefObject<HTMLElement | null>, player: MountablePlayback) {
  const [paintedFor, setPaintedFor] = useState<MountablePlayback>();
  const [failure, setFailure] = useState<{ player: MountablePlayback; error: Error }>();
  useEffect(() => {
    const abort = new AbortController();
    let unmount: (() => void) | undefined;
    const fail = (cause: unknown) => {
      if (abort.signal.aborted) return;
      const error = cause instanceof Error ? cause : new Error('The recorded page could not be mounted.');
      setFailure({ player, error });
    };
    const mount = () => {
      const root = host.current;
      if (abort.signal.aborted || !root) return;
      try {
        unmount = player.mount(root);
        void waitForReplayPaint(root, abort.signal).then(() => {
          if (!abort.signal.aborted) setPaintedFor(player);
        }, fail);
      } catch (cause) {
        fail(cause);
      }
    };
    if (swappingInPlace()) mount();
    else void afterPageTransition().then(mount);
    return () => {
      abort.abort();
      unmount?.();
    };
  }, [host, player]);
  if (failure?.player === player) throw failure.error;
  return paintedFor === player;
}
