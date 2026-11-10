import { useId } from 'react';

import { areaPath, dipPath, type FrameBand, fpsCeiling, fpsY, linePath, SPARK_HEIGHT, SPARK_WIDTH, sparkRuns } from './frames.ts';

const GUIDES = [60, 30] as const;
const DANGER_BELOW_FPS = 30;

/**
 * Frames per second over the replay as a line with a light fill, guides at 60 and 30, the stretch under 30 tinted in
 * danger. It fills the timeline's plot column, so its x axis is the lanes' above it.
 */
export function FpsPlot({ bands, span }: { bands: readonly FrameBand[]; span: number }) {
  const clip = useId();
  const ceiling = fpsCeiling(bands);
  const runs = sparkRuns(bands, span, ceiling);
  const dangerTop = fpsY(DANGER_BELOW_FPS, ceiling);
  return (
    <div className="pt-fps" data-testid="fps-lane" role="img" aria-label="Frame rate over time">
      <div className="fps-plot">
      {GUIDES.map((fps) => (
        <span key={fps} className="fps-guide" style={{ top: `${fpsY(fps, ceiling)}%` }} />
      ))}
      <svg viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={dangerTop} width={SPARK_WIDTH} height={SPARK_HEIGHT - dangerTop} />
          </clipPath>
        </defs>
        {runs.map((run) => (
          <g key={run[0]?.x ?? 0}>
            <path className="fps-area" d={areaPath(run)} />
            <path className="fps-danger" d={dipPath(run, dangerTop)} clipPath={`url(#${clip})`} />
            <path className="fps-line" d={linePath(run)} />
          </g>
        ))}
      </svg>
      {GUIDES.map((fps) => (
        <span key={fps} className="fps-guide-label" style={{ top: `${fpsY(fps, ceiling)}%` }}>
          {fps}
        </span>
      ))}
      </div>
    </div>
  );
}
