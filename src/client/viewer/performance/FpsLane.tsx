import { type MouseEvent, type PointerEvent, useId, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { formatClock } from '../../../shared/replay.ts';
import { usePlayheadProgress } from '../../hooks/use-playhead-progress.ts';
import { usePlayer } from '../../player.ts';
import {
  areaPath,
  dipPath,
  type FrameBand,
  fpsCeiling,
  fpsY,
  linePath,
  readingAt,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparkRuns,
} from './frames.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the lane shares the ribbon's playhead and veil styles, loaded with the lazy inspector.
import '../time-ribbon.css';

const GUIDES = [60, 30] as const;
const DANGER_BELOW_FPS = 30;

const fraction = (event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
};

/**
 * The frame-rate lane at the bottom of the time ribbon, on the same domain and playhead: a line and light fill of
 * frames per second (0 to the display's rate), guides at 30 and 60, the stretch under 30 tinted in the fill. Hover reads
 * a second's rate; a click seeks.
 */
export function FpsLane({ bands, duration, collapsed }: { bands: readonly FrameBand[]; duration: number; collapsed: boolean }) {
  const player = usePlayer();
  const lane = useRef<HTMLButtonElement>(null);
  const clip = useId();
  const [hover, setHover] = useState<number>();
  const span = Math.max(1, duration);
  usePlayheadProgress(lane, span);
  const ceiling = fpsCeiling(bands);
  const runs = sparkRuns(bands, span, ceiling);
  const reading = hover === undefined ? undefined : readingAt(bands, hover, span);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (collapsed || event.pointerType === 'touch') return;
    setHover(fraction(event));
  };
  const dangerTop = fpsY(DANGER_BELOW_FPS, ceiling);
  return (
    <button
      ref={lane}
      type="button"
      className="fps-lane"
      data-testid="fps-lane"
      aria-label="Frame rate over time, click to seek"
      tabIndex={collapsed ? -1 : undefined}
      onClick={(event) => {
        if (event.detail === 0) return;
        player.seek(fraction(event) * span);
      }}
      onPointerMove={move}
      onPointerLeave={() => setHover(undefined)}
    >
      <span className="fps-plot" aria-hidden="true">
        {GUIDES.map((fps) => (
          <span key={fps} className="fps-guide" style={{ top: `${fpsY(fps, ceiling)}%` }} />
        ))}
        <svg viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" focusable="false">
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={dangerTop} width={SPARK_WIDTH} height={SPARK_HEIGHT - dangerTop} />
            </clipPath>
          </defs>
          {runs.map((run) => {
            const key = run[0]?.x ?? 0;
            return (
              <g key={key}>
                <path className="fps-area" d={areaPath(run)} />
                <path className="fps-danger" d={dipPath(run, dangerTop)} clipPath={`url(#${clip})`} />
                <path className="fps-line" d={linePath(run)} />
              </g>
            );
          })}
        </svg>
        {GUIDES.map((fps) => (
          <span key={fps} className="fps-guide-label" style={{ top: `${fpsY(fps, ceiling)}%` }}>
            {fps}
          </span>
        ))}
      </span>
      <span className="ribbon-future" />
      <span className="ribbon-now" />
      {reading ? (
        <Tooltip open>
          <TooltipTrigger render={<span className="fps-cursor" style={{ left: `${(hover ?? 0) * 100}%` }} />} />
          <TooltipContent side="top">
            {formatClock(reading.time)} · {reading.fps === undefined ? 'no samples' : `${Math.round(reading.fps)} fps`}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </button>
  );
}
