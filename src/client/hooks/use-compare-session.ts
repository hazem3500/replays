import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CompareSession } from '../compare/session.ts';
import type { CompareTile } from '../compare/tiles.ts';

/** One session per comparison page; the clock holds nothing until tiles mount, so it needs no other cleanup. */
export function useCompareSession(
  tiles: readonly CompareTile[],
  focus: string,
  initialTime: number | undefined,
  /** Single layout: switching the focused run restarts the playhead (Grid/Spotlight keep the shared time). */
  restartOnFocusChange = false,
) {
  const [session] = useState(() => {
    const created = new CompareSession(tiles, focus);
    if (initialTime) created.clock.seekWhenReady(initialTime);
    return created;
  });
  const previousFocus = useRef(focus);
  // why: before paint, so the transport and inspector never draw a frame for the previous set or focus.
  useLayoutEffect(() => session.sync(tiles), [session, tiles]);
  useLayoutEffect(() => {
    const switched = previousFocus.current !== focus;
    previousFocus.current = focus;
    session.focus(focus, switched && restartOnFocusChange);
  }, [session, focus, restartOnFocusChange]);
  useEffect(() => () => session.clock.pause(), [session]);
  return session;
}
