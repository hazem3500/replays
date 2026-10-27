import { formatDuration } from './format.ts';
import type { Recorder, RecorderState } from './types.ts';

export type TimerOptions = { warnAtMs?: number; finalAtMs?: number; now?: () => number };
export type TimerSnapshot = {
  elapsedMs: number;
  remainingMs: number;
  maxDurationMs: number;
  fraction: number;
  warning: 'none' | 'soon' | 'final';
  sizeWarning: 'none' | 'soon';
  label: string;
  remainingLabel: string;
};
function timerWarning(remainingMs: number, options: TimerOptions): TimerSnapshot['warning'] {
  if (remainingMs <= (options.finalAtMs ?? 10000)) return 'final';
  if (remainingMs <= (options.warnAtMs ?? 30000)) return 'soon';
  return 'none';
}
export function recordingTimer(state: RecorderState, now = Date.now(), options: TimerOptions = {}): TimerSnapshot | undefined {
  if (state.status !== 'recording') return undefined;
  const elapsedMs = Math.max(0, now - state.startedAt);
  const remainingMs = Math.max(0, state.maxDurationMs - elapsedMs);
  return {
    elapsedMs,
    remainingMs,
    maxDurationMs: state.maxDurationMs,
    fraction: Math.min(1, elapsedMs / state.maxDurationMs),
    warning: timerWarning(remainingMs, options),
    sizeWarning: 'none',
    label: formatDuration(elapsedMs),
    remainingLabel: formatDuration(remainingMs),
  };
}
export function createRecordingTimer(recorder: Recorder, options: TimerOptions = {}) {
  const listeners = new Set<() => void>();
  let snapshot: TimerSnapshot | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const tick = () => {
    clearTimeout(timer);
    snapshot = recordingTimer(recorder.getState(), options.now?.() ?? Date.now(), options);
    const progress = recorder.getProgress();
    if (snapshot && progress && progress.bytes >= progress.maxBytes * 0.8) snapshot.sizeWarning = 'soon';
    for (const listener of listeners) listener();
    if (snapshot && !disposed) timer = setTimeout(tick, 1000 - (snapshot.elapsedMs % 1000));
  };
  const unsubscribe = recorder.subscribe(tick);
  tick();
  return {
    get: () => snapshot,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      listeners.clear();
    },
  };
}
