import type { EditTimeline } from '../../../shared/edits.ts';
import { type FrameSample, type FrameVerdict, fpsVerdict, sampleFps } from '../../../shared/frame-timing.ts';

/** One second of frame rate on the player's clock (after edits). */
export interface FrameBand {
  at: number;
  end: number;
  fps: number;
  dropped: number;
  verdict: FrameVerdict;
}

/** Frame samples as bands on the player's clock; samples inside a cut are dropped. */
export function frameBands(samples: readonly FrameSample[] | undefined, timeline?: EditTimeline): FrameBand[] {
  return (samples ?? []).flatMap((sample) => {
    const stop = sample.at + sample.elapsed;
    if (timeline && (timeline.isRemoved(sample.at) || sample.at > timeline.originalDuration)) return [];
    const at = timeline ? timeline.toEdited(sample.at) : sample.at;
    const end = timeline ? timeline.toEdited(Math.min(stop, timeline.originalDuration)) : stop;
    if (end <= at) return [];
    const fps = sampleFps(sample);
    return [{ at, end, fps, dropped: sample.dropped, verdict: fpsVerdict(fps) }];
  });
}

/** The band holding `time`, or undefined in a gap. */
export function bandAt(bands: readonly FrameBand[], time: number) {
  return bands.find((band) => time >= band.at && time < band.end);
}
