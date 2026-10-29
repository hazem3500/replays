import { type RefObject, useLayoutEffect } from 'react';

import { usePlayer } from '../player.ts';

/**
 * Writes the playhead's position over `span` ms (0 to 1) to `--progress` on the element, outside React, so a strip can
 * move its playhead with a transform and a CSS transition instead of re-rendering on every tick of the clock.
 */
export function usePlayheadProgress(target: RefObject<HTMLElement | null>, span: number) {
  const player = usePlayer();
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    const write = () => element.style.setProperty('--progress', String(Math.min(1, Math.max(0, player.getTime() / Math.max(1, span)))));
    write();
    return player.subscribeTime(write);
  }, [player, target, span]);
}
