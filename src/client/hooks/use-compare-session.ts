import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CompareSession } from '../compare/session.ts';
import type { CompareTile } from '../compare/tiles.ts';

/** One session per comparison page, on one run's timeline in Single and on the longest run's otherwise; the clock holds nothing until tiles mount, so it needs no other cleanup. */
export function useCompareSession(
  tiles: readonly CompareTile[],
  focus: string,
  initialTime: number | undefined,
  /** Single layout: the focused run's own length is the timeline and switching runs restarts the playhead (Grid/Spotlight keep the shared time). */
  single = false,
) {
  const [session] = useState(() => {
    const created = new CompareSession(tiles, focus);
    if (single) created.clock.setScope(focus);
    if (initialTime) created.clock.seekWhenReady(initialTime);
    return created;
  });
  const previousFocus = useRef(focus);
  // why: before paint, so the transport and inspector never draw a frame for the previous set or focus.
  useLayoutEffect(() => session.sync(tiles), [session, tiles]);
  useLayoutEffect(() => {
    const switched = previousFocus.current !== focus;
    previousFocus.current = focus;
    session.focus(focus, switched && single);
  }, [session, focus, single]);
  // why: in Single the shown run's own length is the timeline; the longest run's counts only with several tiles on stage.
  useLayoutEffect(() => session.clock.setScope(single ? focus : undefined), [session, single, focus]);
  useEffect(() => () => session.clock.pause(), [session]);
  return session;
}
