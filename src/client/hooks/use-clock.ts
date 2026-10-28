import { useSyncExternalStore } from 'react';

import type { ClockSnapshot, SharedClock } from '../compare/clock.ts';

/** Structural clock state (play status, ended tiles). Selectors returning primitives re-render least. */
export function useClockState<T>(clock: SharedClock, select: (snapshot: ClockSnapshot) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.getSnapshot()));
}
