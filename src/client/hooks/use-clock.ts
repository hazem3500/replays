import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';

import { MeetingClock, type MeetingSnapshot } from '../comparison/meeting/clock.ts';

/** One shared clock per comparison; it holds no resources until players attach, so StrictMode needs no cleanup. */
export function useMeetingClock(initialTime?: number) {
  const [clock] = useState(() => {
    const created = new MeetingClock();
    if (initialTime) created.seekWhenReady(initialTime);
    return created;
  });
  useEffect(() => () => clock.pause(), [clock]);
  return clock;
}

/** Structural state (play status, speed, tile boundaries). Selectors returning primitives re-render least. */
export function useClockState<T>(clock: MeetingClock, select: (snapshot: MeetingSnapshot) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.getSnapshot()));
}

/**
 * Writes an element from the shared playhead on every frame and after every seek, without rendering:
 * `const ref = useClockFrame(clock, (element, time) => …)` then `<time ref={ref} />`.
 */
export function useClockFrame<E extends Element>(clock: MeetingClock, write: (element: E, time: number) => void) {
  const element = useRef<E>(null);
  const onFrame = useEffectEvent((time: number) => {
    if (element.current) write(element.current, time);
  });
  useEffect(() => clock.onFrame((time) => onFrame(time)), [clock]);
  return element;
}

/** Runs `listener` after each structural change, outside render (announcements, imperative bookkeeping). */
export function useClockChange(clock: MeetingClock, listener: (snapshot: MeetingSnapshot) => void) {
  const onChange = useEffectEvent(listener);
  useEffect(() => clock.subscribe(() => onChange(clock.getSnapshot())), [clock]);
}
