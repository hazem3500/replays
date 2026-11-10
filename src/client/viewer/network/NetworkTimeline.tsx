import { type PointerEvent, useRef, useState } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { useElementWidth } from '../../hooks/use-element-width.ts';
import { usePlayheadProgress } from '../../hooks/use-playhead-progress.ts';
import { useRibbonBrush } from '../../hooks/use-ribbon-brush.ts';
import { usePlayer } from '../../player.ts';
import { LaneGutter, LaneRows, Playhead, RangeAndLit, TimeAxis, Crosshair } from '../performance/PerfTimelineParts.tsx';
import { useRibbonCollapsed } from '../ribbon-collapse.ts';
import type { RibbonRange } from '../TimeRibbon.tsx';
import { bucketRequests, formatDuration, type NetworkRow, type RequestBucket } from './model.ts';
import { buildNetworkLanes, NETWORK_LANE_NAMES, networkGutter } from './timeline-lanes.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline reuses the ribbon's playhead, veil and range styles, loaded with the lazy inspector.
import '../time-ribbon.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline's shared styles load with the lazy inspector chunk, not with every page.
import '../performance/perf-timeline.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the density lane's styles load with the lazy inspector chunk.
import './network-timeline.css';

const FIRST_WIDTH = 640;
const BIN_PX = 5;
const MIN_BINS = 24;
const MAX_BINS = 200;
/** The axis row above the lanes, and the density lane's height: the pointer is over the lane between these. */
const AXIS_PX = 24;
const DENSITY_PX = 32;

export const NETWORK_TIMELINE_STRINGS = {
  hint: 'Click to seek. Drag the playhead to scrub. Drag across the timeline to filter the requests. Failed requests are rose marks, slow ones amber.',
};

/** Where the pointer is in the density lane: its bucket, or undefined when it is over the axis or another lane. */
function bucketUnder(event: PointerEvent<HTMLElement>, bins: number) {
  const box = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - box.top;
  if (y < AXIS_PX || y > AXIS_PX + DENSITY_PX) return;
  return Math.min(bins - 1, Math.max(0, Math.floor(((event.clientX - box.left) / Math.max(1, box.width)) * bins)));
}

const noop = () => {};

const name = (row: NetworkRow) => `${row.entry.method} ${row.name.path}`;

function BucketTip({ bucket, bin, bins, span }: { bucket: RequestBucket; bin: number; bins: number; span: number }) {
  const [failed] = bucket.failed;
  const slowest = bucket.slowest;
  return (
    <span className="nt-tip" style={{ left: `clamp(80px, ${((bin + 0.5) / bins) * 100}%, calc(100% - 80px))` }} aria-hidden="true">
      <strong>
        {formatClock((bin / bins) * span)} to {formatClock(((bin + 1) / bins) * span)}
      </strong>
      <span>{bucket.count === 1 ? '1 request' : `${bucket.count} requests`}</span>
      {failed ? (
        <span data-tone="failed">
          Failed: {name(failed)}
          {bucket.failed.length > 1 ? ` and ${bucket.failed.length - 1} more` : ''}
        </span>
      ) : null}
      {slowest ? (
        <span>
          Slowest: {name(slowest)} · {formatDuration(slowest.measured ?? slowest.end - slowest.at)}
        </span>
      ) : null}
    </span>
  );
}

function DensityLane({ buckets, total, hot }: { buckets: readonly RequestBucket[]; total: number; hot: number | undefined }) {
  const most = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div className="pt-lane" data-lane="density" role="img" aria-label={`${NETWORK_LANE_NAMES.requests}: ${total} over the recording`}>
      <svg className="nt-density" viewBox={`0 0 ${buckets.length} 100`} preserveAspectRatio="none" focusable="false" aria-hidden="true">
        {buckets.map((bucket) => {
          // why: a square-root scale keeps one request visible next to a burst of sixty.
          const height = Math.max(8, Math.sqrt(bucket.count / most) * 100);
          return bucket.count ? (
            <rect
              key={bucket.bin}
              data-hot={bucket.bin === hot || undefined}
              x={bucket.bin + 0.1}
              width={0.8}
              y={100 - height}
              height={height}
            />
          ) : null;
        })}
      </svg>
    </div>
  );
}

/**
 * When requests happened, on the Performance timeline's own axis, gutter, playhead and crosshair: a compact lane of how
 * many started in each slice of the recording, and thin lanes of the slow (amber) and failed (rose) ones. A click seeks,
 * a drag filters the table, a mark lights its row and back. Collapsed (from the toolbar's timeline button), nothing is drawn.
 */
export function NetworkTimeline({
  rows,
  duration,
  range,
  onRange,
  lit,
  onLight,
}: {
  rows: readonly NetworkRow[];
  duration: number;
  range: RibbonRange | undefined;
  onRange: (range: RibbonRange | undefined) => void;
  /** Request ids to raise: the hovered or selected row, or the marks under the pointer. */
  lit: readonly string[];
  onLight: (ids: readonly string[]) => void;
}) {
  const player = usePlayer();
  const span = Math.max(1, duration);
  const plot = useRef<HTMLDivElement>(null);
  const width = useElementWidth(plot, FIRST_WIDTH);
  const collapsed = useRibbonCollapsed('network');
  const [pointer, setPointer] = useState<{ at: number; bin: number | undefined } | null>(null);
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  usePlayheadProgress(plot, span);
  const bins = Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(width / BIN_PX)));
  const buckets = bucketRequests(rows, span, bins);
  const lanes = buildNetworkLanes(rows);
  if (collapsed) return null;
  const track = (event: PointerEvent<HTMLElement>) => {
    handlers.onPointerMove(event);
    if (event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    setPointer({ at: Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))), bin: bucketUnder(event, bins) });
  };
  const hoverBin = pointer?.bin;
  const tipped = hoverBin === undefined ? undefined : buckets[hoverBin];
  return (
    <div className="pt nt" data-testid="network-timeline">
      <div className="pt-body">
        <LaneGutter lanes={networkGutter(lanes)} withFrames={false} />
        <div
          ref={plot}
          id="network-timeline-plot"
          className="pt-plot"
          data-testid="network-ribbon"
          aria-description={NETWORK_TIMELINE_STRINGS.hint}
          {...handlers}
          onPointerMove={track}
          onPointerLeave={() => setPointer(null)}
        >
          <TimeAxis span={span} width={width} hint={NETWORK_TIMELINE_STRINGS.hint} />
          <LaneRows lanes={lanes} span={span} width={width} lit={lit} focusable onLight={onLight} onPick={noop}>
            <DensityLane buckets={buckets} total={rows.length} hot={hoverBin} />
          </LaneRows>
          <RangeAndLit lanes={lanes} lit={lit} span={span} shown={brush ?? range} brushing={Boolean(brush)} />
          <Crosshair hover={pointer?.at} frames={[]} span={span} collapsed={false} />
          {tipped?.count && hoverBin !== undefined ? <BucketTip bucket={tipped} bin={hoverBin} bins={bins} span={span} /> : null}
          <Playhead span={span} plot={plot} collapsed={false} />
        </div>
      </div>
    </div>
  );
}
