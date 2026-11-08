import type { ReplayPerformanceTrack } from '../shared/replay.ts';

/** Samples foreground animation cadence in one-second windows with a fixed retained-record cap. */
export function captureFramePacing(track: ReplayPerformanceTrack, grow: (bytes: number) => void): () => void {
  if (typeof requestAnimationFrame !== 'function') return () => {};
  const samples: NonNullable<ReplayPerformanceTrack['frames']> = [];
  track.frames = samples;
  track.supported.push('animation-frame');
  let previous = 0;
  let start = 0;
  let frames = 0;
  let dropped = 0;
  let handle = 0;
  let stopped = false;
  const reset = () => {
    previous = 0;
    start = 0;
    frames = 0;
    dropped = 0;
  };
  document.addEventListener('visibilitychange', reset);
  const frame = (now: number) => {
    if (stopped) return;
    if (document.hidden) reset();
    else {
      if (!start) start = now;
      if (previous) {
        frames += 1;
        dropped += Math.max(0, Math.round((now - previous) / (1000 / 60)) - 1);
      }
      previous = now;
      if (now - start >= 1000) {
        const sample = { at: performance.timeOrigin + start, elapsed: now - start, frames, dropped };
        samples.push(sample);
        grow(JSON.stringify(sample).length);
        start = now;
        frames = 0;
        dropped = 0;
      }
    }
    if (samples.length < 600) handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', reset);
  };
}
