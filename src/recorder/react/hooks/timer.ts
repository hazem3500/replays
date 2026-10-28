import { useState, useSyncExternalStore } from 'react';
import { createRecordingTimer, recordingTimer } from '../../timer.ts';
import type { TimerOptions, TimerSnapshot } from '../../timer.ts';
import type { Recorder, RecorderState } from '../../types.ts';

function recordingClock(recorder: Recorder) {
  let clock: number | undefined;
  return {
    get: () => clock,
    subscribe(this: void, listener: () => void): () => void {
      const timer = createRecordingTimer(recorder);
      const update = () => {
        const snapshot = timer.get();
        const state = recorder.getState();
        clock = snapshot && state.status === 'recording' ? state.startedAt + snapshot.elapsedMs : undefined;
        listener();
      };
      update();
      const off = timer.subscribe(update);
      return () => {
        off();
        timer.dispose();
      };
    },
  };
}
function snapshotAt(state: RecorderState, clock: number | undefined, options: TimerOptions, recorder: Recorder): TimerSnapshot | undefined {
  const snapshot = recordingTimer(state, options.now?.() ?? clock ?? Date.now(), options);
  const progress = recorder.getProgress();
  if (snapshot && progress && progress.bytes >= progress.maxBytes * 0.8) snapshot.sizeWarning = 'soon';
  return snapshot;
}
export function useTimerSnapshot(recorder: Recorder, options: TimerOptions): TimerSnapshot | undefined {
  const [source] = useState(() => recordingClock(recorder));
  const clock = useSyncExternalStore(source.subscribe, source.get, source.get);
  return snapshotAt(recorder.getState(), clock, options, recorder);
}
