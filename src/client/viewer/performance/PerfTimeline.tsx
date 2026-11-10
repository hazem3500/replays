import { type PointerEvent, useRef, useState } from 'react';

import { useElementWidth } from '../../hooks/use-element-width.ts';
import { usePlayheadProgress } from '../../hooks/use-playhead-progress.ts';
import { useRibbonBrush } from '../../hooks/use-ribbon-brush.ts';
import { usePlayer } from '../../player.ts';
import { useRibbonCollapsed } from '../ribbon-collapse.ts';
import type { RibbonRange } from '../TimeRibbon.tsx';
import { FpsPlot } from './FpsPlot.tsx';
import type { FrameBand } from './frames.ts';
import {
  Crosshair,
  LaneGutter,
  LaneRows,
  Playhead,
  RangeAndLit,
  TIMELINE_STRINGS,
  TimelineToggle,
  TimeAxis,
} from './PerfTimelineParts.tsx';
import type { Lane, LaneMark } from './timeline-model.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline reuses the ribbon's playhead, veil and range styles, loaded with the lazy inspector.
import '../time-ribbon.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline's styles load with the lazy inspector chunk, not with every page.
import './perf-timeline.css';

/** The plot's width before it is measured, so the first paint clusters about right. */
const FIRST_WIDTH = 640;

/**
 * Where it was slow, on one time axis: a lane each for the interactions, long tasks, slow requests and layout shifts the
 * recording has, then the frame rate. Lanes and plot share one column, so a gridline, the crosshair and the playhead
 * cross all of them. A click seeks, a drag filters, the playhead handle scrubs; a mark lights its table row and back.
 */
export function PerfTimeline({
  duration,
  lanes,
  frames,
  range,
  onRange,
  lit,
  onLight,
  onPick,
}: {
  duration: number;
  lanes: readonly Lane[];
  frames: readonly FrameBand[];
  range: RibbonRange | undefined;
  onRange: (range: RibbonRange | undefined) => void;
  /** Moment ids to raise: the hovered or selected row, or the marks under the pointer. */
  lit: readonly string[];
  onLight: (ids: readonly string[]) => void;
  /** A mark was clicked: select its moment when it has one. */
  onPick: (mark: LaneMark) => void;
}) {
  const player = usePlayer();
  const span = Math.max(1, duration);
  const plot = useRef<HTMLDivElement>(null);
  const width = useElementWidth(plot, FIRST_WIDTH);
  const collapsed = useRibbonCollapsed();
  const [hover, setHover] = useState<number>();
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  usePlayheadProgress(plot, span);
  const track = (event: PointerEvent<HTMLElement>) => {
    handlers.onPointerMove(event);
    if (collapsed || event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))));
  };
  return (
    <div className="pt" data-collapsed={collapsed || undefined} data-testid="performance-timeline">
      <div className="pt-body">
        <LaneGutter lanes={lanes} withFrames={frames.length > 0} />
        <div
          ref={plot}
          id="performance-timeline-plot"
          className="pt-plot"
          data-testid="performance-ribbon"
          aria-description={TIMELINE_STRINGS.hint}
          {...handlers}
          onPointerMove={track}
          onPointerLeave={() => setHover(undefined)}
        >
          <TimeAxis span={span} width={width} />
          <LaneRows lanes={lanes} span={span} width={width} lit={lit} focusable={!collapsed} onLight={onLight} onPick={onPick} />
          {frames.length ? <FpsPlot bands={frames} span={span} /> : null}
          <RangeAndLit lanes={lanes} lit={lit} span={span} shown={brush ?? range} brushing={Boolean(brush)} />
          <Crosshair hover={hover} frames={frames} span={span} collapsed={collapsed} />
          <Playhead span={span} plot={plot} collapsed={collapsed} />
        </div>
      </div>
      <TimelineToggle collapsed={collapsed} />
    </div>
  );
}
