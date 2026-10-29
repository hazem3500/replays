import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * False on a server render and during the hydration that follows it, true after: values only the browser knows (saved
 * preferences, the platform) render as the server did first, so hydration never mismatches, then switch.
 */
export function useHydrated() {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}
