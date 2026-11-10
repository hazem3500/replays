import { summarizeFrames } from '../../../shared/frame-timing.ts';
import type { ReplayPerformanceTrack } from '../../../shared/replay.ts';

function frameSummary(track: ReplayPerformanceTrack): string {
  const summary = summarizeFrames(track.frames);
  if (!summary) {
    if (track.supported.includes('animation-frame')) return 'No foreground frame samples captured.';
    return 'Frame timing not recorded.';
  }
  return `Foreground cadence: median ${summary.p50.toFixed(1)} FPS, slowest second ${summary.min.toFixed(1)} FPS. Estimated missed frames at a 60 Hz reference: ${summary.dropped}.`;
}

export function CadenceSummary({ track }: { track: ReplayPerformanceTrack }) {
  const shifts = track.supported.includes('layout-shift')
    ? `${track.layoutShifts?.length ?? 0} layout shifts captured.`
    : 'Layout shift observation is unavailable in this browser.';
  return (
    <div className="pp-cadence" role="status">
      {frameSummary(track)} {shifts}
    </div>
  );
}
