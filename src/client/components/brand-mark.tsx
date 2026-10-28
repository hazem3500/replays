import type { Ref } from 'react';

import { HEADER_MARK } from './brand-mark-geometry.ts';

const { segments, top, height, played, playhead } = HEADER_MARK;

/**
 * The built-in product mark (brand-mark-geometry.ts): five timeline segments, two played (accent), and the playhead
 * after them; unplayed segments are the text colour at 35 % (feed.css `.product-mark`). mark-burst.ts animates it
 * through `.mark-seg[data-on]`, `.mark-playhead` and `svg[data-filled]`. A deployment's own logo (config.ts
 * productLogo) replaces it with a plain image.
 */
export function ProductMark({ size = 24, svgRef }: { size?: number; svgRef?: Ref<SVGSVGElement> }) {
  return (
    <svg
      ref={svgRef}
      className="product-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-filled={played}
    >
      {segments.map(([x, width], index) => (
        <rect
          key={x}
          className="mark-seg"
          x={x}
          y={top}
          width={width}
          height={height}
          rx={height / 2}
          data-on={index < played ? '' : undefined}
        />
      ))}
      <g className="mark-playhead" style={{ transform: `translateX(${playhead.x}px)` }}>
        <rect
          x={-playhead.width / 2}
          y={playhead.knob}
          width={playhead.width}
          height={playhead.bottom - playhead.knob}
          rx={playhead.width / 2}
        />
        <circle cx="0" cy={playhead.knob} r={playhead.width} />
      </g>
    </svg>
  );
}
