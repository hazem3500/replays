import { observeType } from './observe.ts';
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
  fromLoad = false,
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
      track.entries.push(signal);
      onEntry(signal);
    }
    count += 1;
  };
  for (const type of ['longtask', 'event', 'paint', 'largest-contentful-paint', 'layout-shift']) {
    const observer = observeType(
      type,
      (entries) => {
        if (!active) return;
        for (const entry of entries) {
          if (count >= 500) break;
          retain(type, entry);
        }
      },
      fromLoad,
    );
    if (!observer) continue;
    observers.push(observer);
    track.supported.push(type);
  }
  return {
    track,
    stop() {
      active = false;
      for (const observer of observers) observer.disconnect();
    },
  };
}
