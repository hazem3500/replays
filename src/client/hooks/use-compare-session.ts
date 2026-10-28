import { useEffect, useLayoutEffect, useState } from 'react';

import { CompareSession } from '../compare/session.ts';
import type { CompareTile } from '../compare/tiles.ts';

/** One session per comparison page; the clock holds nothing until tiles mount, so it needs no other cleanup. */
export function useCompareSession(tiles: readonly CompareTile[], focus: string, initialTime: number | undefined) {
  const [session] = useState(() => {
    const created = new CompareSession(tiles, focus);
    if (initialTime) created.clock.seekWhenReady(initialTime);
    return created;
  });
  // why: before paint, so the transport and inspector never draw a frame for the previous set or focus.
  useLayoutEffect(() => session.sync(tiles), [session, tiles]);
  useLayoutEffect(() => session.focus(focus), [session, focus]);
  useEffect(() => () => session.clock.pause(), [session]);
  return session;
}
