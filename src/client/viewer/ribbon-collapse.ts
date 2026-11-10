import { useSyncExternalStore } from 'react';

import { readTimelineCollapsed, type TimelineTab, writeTimelineCollapsed } from '../views/settings.ts';

const listeners = new Set<() => void>();
const collapsed = new Map<TimelineTab, boolean>();

/** Whether a tab's timeline is collapsed. Remembered across replays, per tab; the first read comes from storage. */
export function ribbonCollapsed(tab: TimelineTab = 'performance') {
  let value = collapsed.get(tab);
  if (value === undefined) {
    value = readTimelineCollapsed(tab);
    collapsed.set(tab, value);
  }
  return value;
}

export function setRibbonCollapsed(value: boolean, tab: TimelineTab = 'performance') {
  if (value === ribbonCollapsed(tab)) return;
  collapsed.set(tab, value);
  writeTimelineCollapsed(tab, value);
  for (const listener of listeners) listener();
}

export function toggleRibbonCollapsed(tab: TimelineTab = 'performance') {
  setRibbonCollapsed(!ribbonCollapsed(tab), tab);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Each tab keeps its own choice, so collapsing the Network timeline leaves the Performance one as it was. */
export function useRibbonCollapsed(tab: TimelineTab = 'performance') {
  return useSyncExternalStore(
    subscribe,
    () => ribbonCollapsed(tab),
    () => false,
  );
}
