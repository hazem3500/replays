import { useSyncExternalStore } from 'react';

/**
 * The few bits of UI state the viewer's own code (the More menu) and the lazily loaded workshop share. Kept tiny and
 * dependency-free so the viewer can import it without pulling the workshop in.
 */
export interface MalleableUi {
  workshopOpen: boolean;
  /** Plugin id whose "keep" dialog is open. */
  keepFor: string | undefined;
}

let state: MalleableUi = { workshopOpen: false, keepFor: undefined };
const listeners = new Set<() => void>();

export function setMalleableUi(patch: Partial<MalleableUi>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const getMalleableUi = () => state;
export const subscribeMalleableUi = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useMalleableUi = () => useSyncExternalStore(subscribeMalleableUi, getMalleableUi);
export const openWorkshop = () => setMalleableUi({ workshopOpen: true });
