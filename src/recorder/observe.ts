import { takeEarly } from './early-queue.ts';

/**
 * Observes one entry type and hands `handle` the entries it sees. With `fromLoad`, entries from before the recorder
 * started are included: the early entry's queue when the host runs it, else the browser's own buffer. Returns the
 * observer, or undefined where the type is unsupported or blocked.
 */
export function observeType(
  type: string,
  handle: (entries: PerformanceEntry[]) => void,
  fromLoad: boolean,
  options: { durationThreshold?: number } = {},
): PerformanceObserver | undefined {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes(type)) return;
  try {
    const observer = new PerformanceObserver((list) => handle(list.getEntries()));
    const early = fromLoad ? takeEarly(type) : undefined;
    if (early) handle(early);
    const init: PerformanceObserverInit & { durationThreshold?: number } = { type, buffered: fromLoad && !early, ...options };
    observer.observe(init);
    return observer;
  } catch {
    // why: advertised observer types may still be unavailable under browser policy.
    return;
  }
}
