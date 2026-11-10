import { type RefObject, useLayoutEffect } from 'react';

import type { Playback } from '../playback/types.ts';

/** Keeps a slider's `aria-valuenow` on the playhead's time in seconds without rendering the component per tick. */
export function usePlayheadAria(handle: RefObject<HTMLElement | null>, player: Pick<Playback, 'getTime' | 'subscribeTime'>) {
  useLayoutEffect(() => {
    const write = () => handle.current?.setAttribute('aria-valuenow', String(Math.round(player.getTime())));
    write();
    return player.subscribeTime(write);
  }, [handle, player]);
}
