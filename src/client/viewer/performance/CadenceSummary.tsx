import type { ReplayPerformanceTrack } from '../../../shared/replay.ts';

function frameSummary(track: ReplayPerformanceTrack): string {
  if (!track.frames?.length) {
    if (track.supported.includes('animation-frame')) return 'No foreground frame samples captured.';
    return 'Frame timing is unavailable in this browser.';
  }
  const totals = track.frames.reduce(
    (sum, sample) => ({ elapsed: sum.elapsed + sample.elapsed, frames: sum.frames + sample.frames, dropped: sum.dropped + sample.dropped }),
    { elapsed: 0, frames: 0, dropped: 0 },
  );
  return `Foreground cadence: ${((totals.frames * 1000) / totals.elapsed).toFixed(1)} FPS. Estimated missed frames at a 60 Hz reference: ${totals.dropped}.`;
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
