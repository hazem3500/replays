import { lazy } from 'react';

type RoomModule = typeof import('./SuiteMeeting.tsx');

let loaded: RoomModule | undefined;
let pending: Promise<RoomModule> | undefined;

/** The meeting view is its own chunk: a suite that stays in focus never downloads it. */
export const loadMeetingRoom = () => (pending ??= import('./SuiteMeeting.tsx').then((module) => (loaded = module)));

export const meetingRoomLoaded = () => loaded !== undefined;

/**
 * Lazy until loaded, then synchronous: React.lazy would otherwise suspend for one microtask even for a loaded
 * chunk, and the layout crossfade would capture the fallback instead of the tiles.
 */
export const LazyMeetingRoom = lazy(() => {
  if (!loaded) return loadMeetingRoom().then((module) => ({ default: module.SuiteMeeting }));
  const value = { default: loaded.SuiteMeeting };
  // why: React.lazy only calls `then`; the cast is for its Promise-typed signature.
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- why: a thenable that settles synchronously for a loaded chunk
    then<A>(onFulfilled?: ((result: typeof value) => A | PromiseLike<A>) | null) {
      return Promise.resolve(onFulfilled ? onFulfilled(value) : (value as unknown as A));
    },
  } as unknown as Promise<typeof value>;
});
