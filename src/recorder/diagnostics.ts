import type { ReplayPerformanceEntry, ReplayPerformanceTrack } from '../shared/replay.ts';

/** Observes only numeric browser timing entries, never DOM content or application state. */
export function capturePerformance(
  onEntry: (entry: ReplayPerformanceEntry) => void,
  grow: (bytes: number) => void = () => {},
): { track: ReplayPerformanceTrack; stop: () => void } {
  const track: ReplayPerformanceTrack = { supported: [], entries: [] };
  const observers: PerformanceObserver[] = [];
  let count = 0;
  let active = true;
  const types = typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  for (const type of ['longtask', 'event', 'paint', 'largest-contentful-paint', 'layout-shift']) {
    if (!types.includes(type)) continue;
    try {
      const observer = new PerformanceObserver((list) => {
        if (!active) return;
        for (const entry of list.getEntries()) {
          if (count >= 500 || entry.startTime < 0) break;
          if (type === 'layout-shift') {
            const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
            if (typeof shift.value !== 'number' || !Number.isFinite(shift.value) || shift.value < 0) continue;
            const shifts = (track.layoutShifts ??= []);
            const sample = {
              at: performance.timeOrigin + entry.startTime,
              value: shift.value,
              hadRecentInput: shift.hadRecentInput === true,
            };
            shifts.push(sample);
            grow(JSON.stringify(sample).length);
            count += 1;
            continue;
          }
          const kind =
            type === 'longtask'
              ? 'long-task'
              : type === 'event'
                ? 'slow-interaction'
                : type === 'paint'
                  ? 'first-contentful-paint'
                  : 'largest-contentful-paint';
          if (type === 'paint' && entry.name !== 'first-contentful-paint') continue;
          if (type === 'event' && entry.duration < 104) continue;
          const signal: ReplayPerformanceEntry = {
            at: performance.timeOrigin + entry.startTime,
            kind,
            value: type === 'paint' || type === 'largest-contentful-paint' ? entry.startTime : entry.duration,
            ...(type === 'event' && /^(click|keydown|keyup|input|beforeinput|pointerdown|pointerup|compositionend)$/.test(entry.name)
              ? { eventType: entry.name }
              : {}),
          };
          count += 1;
          onEntry(signal);
        }
      });
      observer.observe({ type, buffered: false });
      observers.push(observer);
      track.supported.push(type);
    } catch {
      // why: advertised observer types may still be unavailable under browser policy.
    }
  }
  return {
    track,
    stop() {
      active = false;
      for (const observer of observers) observer.disconnect();
    },
  };
}
