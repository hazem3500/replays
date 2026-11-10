import { useSyncExternalStore } from 'react';

import { readStorage, writeStorage } from '../../storage.ts';

const KEY = 'replays:performance-details';
const listeners = new Set<() => void>();
let open: boolean | undefined;

/** Whether the stats show as the full grouped grid. Remembered across replays; the compact strip until first opened. */
export function detailsOpen() {
  open ??= readStorage(KEY) === '1';
  return open;
}

export function setDetailsOpen(value: boolean) {
  if (value === detailsOpen()) return;
  open = value;
  writeStorage(KEY, value ? '1' : '0');
  for (const listener of listeners) listener();
}

export function useDetailsOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    detailsOpen,
    () => false,
  );
}
