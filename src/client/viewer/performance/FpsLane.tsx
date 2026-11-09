import { type MouseEvent, useRef } from 'react';

import { usePlayheadProgress } from '../../hooks/use-playhead-progress.ts';
import { usePlayer } from '../../player.ts';
import type { FrameBand } from './frames.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the lane shares the ribbon's playhead and veil styles, loaded with the lazy inspector.
import '../time-ribbon.css';

const SMOOTH_REFERENCE_FPS = 60;

/**
 * The frame-rate lane under the time ribbon, on the same domain: one bar per recorded second, tall for smooth and short
 * for janky, coloured by verdict. A click seeks.
 */
export function FpsLane({ bands, duration }: { bands: readonly FrameBand[]; duration: number }) {
  const player = usePlayer();
  const strip = useRef<HTMLButtonElement>(null);
  const span = Math.max(1, duration);
  usePlayheadProgress(strip, span);
  const seek = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    player.seek(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))) * span);
  };
  return (
    <div className="fps-lane-wrap">
      <button
        ref={strip}
        type="button"
        className="fps-lane"
        data-testid="fps-lane"
        aria-label="Frame rate over time, click to seek"
        onClick={seek}
      >
        {bands.map((band) => (
          <span
            key={band.at}
            data-verdict={band.verdict}
            style={{
              left: `${(band.at / span) * 100}%`,
              width: `${((band.end - band.at) / span) * 100}%`,
              height: `${Math.min(100, Math.max(20, (band.fps / SMOOTH_REFERENCE_FPS) * 100))}%`,
            }}
          />
        ))}
        <span className="ribbon-future" />
        <span className="ribbon-now" />
      </button>
      <div className="ribbon-key">
        <span>
          <i data-tone="success" />
          Smooth
        </span>
        <span>
          <i data-tone="warning" />
          Choppy
        </span>
        <span>
          <i data-tone="danger" />
          Janky
        </span>
        <span>FPS, estimated per second</span>
      </div>
    </div>
  );
}
