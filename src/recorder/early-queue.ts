/** The handoff between the early entry and the recorder: observers started before the recorder existed, and their entries. */
export const EARLY_GLOBAL = '__replaysEarly';

export type EarlyQueue = Record<string, { observer?: PerformanceObserver; entries: PerformanceEntry[] }>;

const isSlot = (value: unknown): value is EarlyQueue[string] => typeof value === 'object' && value !== null && 'entries' in value && Array.isArray(value.entries);

/**
 * Entries the early entry saw for `type`, or undefined when it was not running. The first call stops that observer, since
 * the recorder takes over; later calls (a second consumer of the same type) get the same entries.
 */
export function takeEarly(type: string): PerformanceEntry[] | undefined {
  const queue: Record<string, unknown> = globalThis;
  const holder = queue[EARLY_GLOBAL];
  const slot = typeof holder === 'object' && holder !== null ? Object.entries(holder).find(([key]) => key === type)?.[1] : undefined;
  if (!isSlot(slot)) return;
  if (slot.observer) {
    slot.entries.push(...slot.observer.takeRecords());
    slot.observer.disconnect();
    delete slot.observer;
  }
  return slot.entries;
}
