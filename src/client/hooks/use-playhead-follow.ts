import { useEffect, useRef } from 'react';

import type { TimelineScale } from '../editor/timeline/scale.ts';
import { usePlayer } from '../player.ts';

/** A ref for the playhead line: it moves with the clock on every tick, without re-rendering the timeline. */
export function usePlayheadFollow<T extends HTMLElement>(scale: TimelineScale) {
  const player = usePlayer();
  const element = useRef<T>(null);
  useEffect(() => {
    const place = () => {
      if (element.current) element.current.style.transform = `translateX(${scale.x(player.getTime())}px)`;
    };
    place();
    return player.subscribeTime(place);
  }, [player, scale]);
  return element;
}
