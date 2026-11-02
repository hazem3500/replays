import { type RefObject, useLayoutEffect } from 'react';

import { usePlayer } from '../player.ts';

/**
 * Writes the playhead, as `toValue(time)`, to a CSS custom property on `element` on every clock tick, without
 * re-rendering React: a 1 px line through a whole column moves at 60 fps while the rows stay put.
 */
export function usePlayheadProperty(element: RefObject<HTMLElement | null>, property: string, toValue: (time: number) => string) {
  const player = usePlayer();
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const write = () => node.style.setProperty(property, toValue(player.getTime()));
    write();
    return player.subscribeTime(write);
  }, [element, property, toValue, player]);
}
