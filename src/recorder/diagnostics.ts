import type { ReplayPerformanceEntry, ReplayPerformanceTrack } from '../shared/replay.ts';

const KINDS: Record<string, ReplayPerformanceEntry['kind']> = {
  longtask: 'long-task',
  event: 'slow-interaction',
  paint: 'first-contentful-paint',
  'largest-contentful-paint': 'largest-contentful-paint',
};

function timingSignal(type: string, entry: PerformanceEntry): ReplayPerformanceEntry | undefined {
  const kind = KINDS[type];
  if (!kind) return;
  if (type === 'paint' && entry.name !== 'first-contentful-paint') return;
  if (type === 'event' && entry.duration < 104) return;
  const value = type === 'paint' || type === 'largest-contentful-paint' ? entry.startTime : entry.duration;
  if (!Number.isFinite(value) || value < 0) return;
  const signal: ReplayPerformanceEntry = { at: performance.timeOrigin + entry.startTime, kind, value };
  if (type === 'event' && /^(click|keydown|keyup|input|beforeinput|pointerdown|pointerup|compositionend)$/.test(entry.name)) {
    signal.eventType = entry.name;
  }
  return signal;
}

function layoutShift(entry: PerformanceEntry) {
  const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
  if (typeof shift.value !== 'number' || !Number.isFinite(shift.value) || shift.value < 0) return;
  return { at: performance.timeOrigin + entry.startTime, value: shift.value, hadRecentInput: shift.hadRecentInput === true };
}

/** Observes only numeric browser timing entries, never DOM content or application state. */
export function capturePerformance(
  onEntry: (entry: ReplayPerformanceEntry) => void,
  grow: (bytes: number) => void = () => {},
): { track: ReplayPerformanceTrack; stop: () => void } {
  const track: ReplayPerformanceTrack = { supported: [], entries: [] };
  const observers: PerformanceObserver[] = [];
  let count = 0;
  let active = true;
  const retain = (type: string, entry: PerformanceEntry) => {
    if (!Number.isFinite(entry.startTime) || entry.startTime < 0) return;
    if (type === 'layout-shift') {
      const sample = layoutShift(entry);
      if (!sample) return;
      (track.layoutShifts ??= []).push(sample);
      grow(JSON.stringify(sample).length);
    } else {
      const signal = timingSignal(type, entry);
      if (!signal) return;
      onEntry(signal);
    }
    count += 1;
  };
  const types = typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes;
  for (const type of ['longtask', 'event', 'paint', 'largest-contentful-paint', 'layout-shift']) {
    if (!types.includes(type)) continue;
    try {
      const observer = new PerformanceObserver((list) => {
        if (!active) return;
        for (const entry of list.getEntries()) {
          if (count >= 500) break;
          retain(type, entry);
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
