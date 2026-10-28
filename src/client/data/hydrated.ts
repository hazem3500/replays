import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while React hydrates server-rendered markup (and on the server), true from then on. Hooks render from the
 * hydrated Query data first and switch to live queries after, so the server's markup and the first client render agree.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
