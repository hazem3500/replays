import { useSyncExternalStore } from 'react';

import { readRibbonCollapsed, writeRibbonCollapsed } from '../views/settings.ts';

const listeners = new Set<() => void>();
let collapsed: boolean | undefined;

/** Whether the time ribbon is the slim strip. Remembered across replays; the first read comes from storage. */
export function ribbonCollapsed() {
  collapsed ??= readRibbonCollapsed();
  return collapsed;
}

export function setRibbonCollapsed(value: boolean) {
  if (value === ribbonCollapsed()) return;
  collapsed = value;
  writeRibbonCollapsed(value);
  for (const listener of listeners) listener();
}

export function toggleRibbonCollapsed() {
  setRibbonCollapsed(!ribbonCollapsed());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The Performance and Network ribbons share one choice, so collapsing in one tab holds in the other. */
export function useRibbonCollapsed() {
  return useSyncExternalStore(subscribe, ribbonCollapsed, () => false);
}
