import type { ReplayController } from '../../../player.ts';
import type { InspectorClock, InspectorSource } from '../../../viewer/inspector-scope.ts';
import type { MeetingClock } from '../clock.ts';

/** The meeting's shared clock as the dock's InspectorClock: structural changes and every frame both notify. */
export function meetingInspectorClock(clock: MeetingClock): InspectorClock {
  return {
    getTime: clock.getTime,
    subscribe: (listener) => {
      const structural = clock.subscribe(listener);
      const frames = clock.onFrame(() => listener());
      return () => {
        structural();
        frames();
      };
    },
    seek: clock.seek,
  };
}

/**
 * invariant: interim bridge until the inspector panels read only the InspectorScope (useScopeTime / openRow); delete it
 * then. The panels still call usePlayer() for `duration`, `getTime`, `subscribeTime`, `seek` and `pause`, so the dock
 * gets a player-shaped view of one source on the shared clock: its local time, and seeks that move every tile.
 */
export function scopePlayer(clock: InspectorClock & { pause(): void }, source: InspectorSource, onSeek: () => void) {
  const duration = source.bundle.meta.duration;
  const local = () => Math.min(duration, Math.max(0, clock.getTime() + source.offset));
  const player = {
    duration,
    getTime: local,
    subscribeTime: clock.subscribe,
    seek: (time: number) => {
      clock.seek(time - source.offset);
      onSeek();
    },
    pause: () => clock.pause(),
  };
  return player as unknown as ReplayController;
}
