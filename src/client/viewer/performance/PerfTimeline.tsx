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

interface TimelineProps {
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
}

/**
 * Where it was slow, on one time axis: a lane each for the interactions, long tasks, slow requests and layout shifts the
 * recording has, then the frame rate. Lanes and plot share one column, so a gridline, the crosshair and the playhead
 * cross all of them. A click seeks, a drag filters, the playhead handle scrubs; a mark lights its table row and back.
 */
export function PerfTimeline(props: TimelineProps) {
  // invariant: collapsed renders no plot, lanes or marks at all, only the header row that brings them back; the plot mounts fresh on expand so it measures itself.
  return useRibbonCollapsed() ? (
    <div className="pt" data-collapsed data-testid="performance-timeline">
      <TimelineToggle collapsed />
    </div>
  ) : (
    <TimelinePlot {...props} />
  );
}

function TimelinePlot({
  duration,
  lanes,
  frames,
  range,
  onRange,
  lit,
  onLight,
  onPick,
}: TimelineProps) {
  const player = usePlayer();
  const span = Math.max(1, duration);
  const plot = useRef<HTMLDivElement>(null);
  const width = useElementWidth(plot, FIRST_WIDTH);
  const [hover, setHover] = useState<number>();
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  usePlayheadProgress(plot, span);
  const track = (event: PointerEvent<HTMLElement>) => {
    handlers.onPointerMove(event);
    if (event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))));
  };
  return (
    <div className="pt" data-testid="performance-timeline">
      <div className="pt-body">
        <LaneGutter lanes={lanes} frames={frames} />
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
          <LaneRows lanes={lanes} span={span} width={width} lit={lit} focusable onLight={onLight} onPick={onPick} />
          {frames.length ? <FpsPlot bands={frames} span={span} /> : null}
          <RangeAndLit lanes={lanes} lit={lit} span={span} shown={brush ?? range} brushing={Boolean(brush)} />
          <Crosshair hover={hover} frames={frames} span={span} collapsed={false} />
          <Playhead span={span} plot={plot} collapsed={false} />
        </div>
      </div>
      <TimelineToggle collapsed={false} />
    </div>
  );
}
