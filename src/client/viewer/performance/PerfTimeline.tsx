import { ChevronDownIcon, GaugeIcon, GlobeIcon, HourglassIcon, LayoutPanelLeftIcon, MousePointerClickIcon } from 'lucide-react';
import { type PointerEvent, useLayoutEffect, useRef, useState } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { useElementWidth } from '../../hooks/use-element-width.ts';
import { usePlayheadProgress } from '../../hooks/use-playhead-progress.ts';
import { useRibbonBrush } from '../../hooks/use-ribbon-brush.ts';
import { useRibbonScrub } from '../../hooks/use-ribbon-scrub.ts';
import { usePlayer } from '../../player.ts';
import { toggleRibbonCollapsed, useRibbonCollapsed } from '../ribbon-collapse.ts';
import type { RibbonRange } from '../TimeRibbon.tsx';
import { FpsPlot } from './FpsPlot.tsx';
import { type FrameBand, readingAt } from './frames.ts';
import { LaneMarkButton } from './LaneMarkButton.tsx';
import { clockLabel, clusterMarks, type Lane, type LaneId, type LaneMark, niceTicks } from './timeline-model.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline reuses the ribbon's playhead, veil and range styles, loaded with the lazy inspector.
import '../time-ribbon.css';
// oxlint-disable-next-line import/no-unassigned-import -- why: the timeline's styles load with the lazy inspector chunk, not with every page.
import './perf-timeline.css';

const ICONS = {
  interaction: MousePointerClickIcon,
  task: HourglassIcon,
  request: GlobeIcon,
  shift: LayoutPanelLeftIcon,
  fps: GaugeIcon,
} as const;

const STRINGS = {
  hint: 'Click to seek · Drag the playhead to scrub · Drag to filter',
  hintCollapsed: 'Click to seek',
  toggle: 'Timeline',
  frameRate: 'Frame rate',
  good: 'Good',
  needsWork: 'Needs work',
  poor: 'Poor',
};

const MAX_TICKS = 6;
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
  const handle = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(plot, FIRST_WIDTH);
  const collapsed = useRibbonCollapsed();
  const [hover, setHover] = useState<number>();
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  const scrub = useRibbonScrub(player, span, plot);
  usePlayheadProgress(plot, span);
  useLayoutEffect(() => {
    const write = () => handle.current?.setAttribute('aria-valuenow', String(Math.round(player.getTime())));
    write();
    return player.subscribeTime(write);
  }, [player]);
  const shown = brush ?? range;
  const litItems = lanes.flatMap((lane) => lane.items.filter((item) => item.momentId && lit.includes(item.momentId)));
  const litFrom = Math.min(...litItems.map((item) => item.at));
  const litTo = Math.max(...litItems.map((item) => item.end));
  const reading = hover === undefined || collapsed ? undefined : readingAt(frames, hover, span);
  const track = (event: PointerEvent<HTMLElement>) => {
    handlers.onPointerMove(event);
    if (collapsed || event.pointerType === 'touch') return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))));
  };
  return (
    <div className="pt" data-collapsed={collapsed || undefined} data-testid="performance-timeline">
      <div className="pt-body">
        <div className="pt-gutter" aria-hidden="true">
          <span className="pt-axis-gap" />
          {lanes.map((lane) => (
            <LaneLabel key={lane.id} id={lane.id} text={lane.label} />
          ))}
          {frames.length ? <LaneLabel id="fps" text={STRINGS.frameRate} /> : null}
        </div>
        <div
          ref={plot}
          id="performance-timeline-plot"
          className="pt-plot"
          data-testid="performance-ribbon"
          {...handlers}
          onPointerMove={track}
          onPointerLeave={() => setHover(undefined)}
        >
          <div className="pt-axis" aria-hidden="true">
            {niceTicks(span, MAX_TICKS).map((at) => (
              <span key={at} className="pt-tick" data-first={at === 0 || undefined} style={{ left: `${(at / span) * 100}%` }}>
                {clockLabel(at)}
              </span>
            ))}
          </div>
          <div className="pt-grid" aria-hidden="true">
            {niceTicks(span, MAX_TICKS).map((at) => (
              <span key={at} style={{ left: `${(at / span) * 100}%` }} />
            ))}
          </div>
          <div className="pt-lanes">
            {lanes.map((lane) => (
              <div key={lane.id} className="pt-lane" data-lane={lane.id} role="group" aria-label={lane.label}>
                {clusterMarks(lane.items, span, width).map((mark) => (
                  <LaneMarkButton
                    key={mark.id}
                    mark={mark}
                    span={span}
                    width={width}
                    lit={mark.items.some((item) => item.momentId && lit.includes(item.momentId))}
                    focusable={!collapsed}
                    onLight={onLight}
                    onPick={onPick}
                  />
                ))}
              </div>
            ))}
          </div>
          {frames.length ? <FpsPlot bands={frames} span={span} /> : null}
          {shown ? (
            <span
              className="ribbon-range"
              data-live={brush ? '' : undefined}
              style={{ left: `${(shown.from / span) * 100}%`, width: `${((shown.to - shown.from) / span) * 100}%` }}
            />
          ) : null}
          {litItems.length ? (
            <span
              className="ribbon-lit"
              style={{ left: `${(litFrom / span) * 100}%`, width: `max(3px, ${((litTo - litFrom) / span) * 100}%)` }}
            />
          ) : null}
          {hover === undefined ? null : (
            <>
              <span className="pt-cursor" style={{ left: `${hover * 100}%` }} aria-hidden="true" />
              <span className="pt-readout" style={{ left: `clamp(34px, ${hover * 100}%, calc(100% - 34px))` }} aria-hidden="true">
                {formatClock(hover * span)}
                {reading?.fps === undefined ? '' : ` · ${Math.round(reading.fps)} fps`}
              </span>
            </>
          )}
          <span className="ribbon-future" />
          <span className="ribbon-now">
            <span
              ref={handle}
              className="ribbon-handle"
              data-ribbon-handle=""
              role="slider"
              tabIndex={collapsed ? -1 : 0}
              aria-hidden={collapsed || undefined}
              aria-label="Playhead"
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.round(span)}
              aria-valuenow={0}
              {...scrub}
            />
          </span>
        </div>
      </div>
      <div className="ribbon-key">
        <Legend />
        <span className="pt-hint">{collapsed ? STRINGS.hintCollapsed : STRINGS.hint}</span>
        <button
          type="button"
          className="ribbon-toggle"
          aria-label={STRINGS.toggle}
          aria-expanded={!collapsed}
          aria-controls="performance-timeline-plot"
          onClick={toggleRibbonCollapsed}
        >
          <ChevronDownIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function LaneLabel({ id, text }: { id: LaneId | 'fps'; text: string }) {
  const Icon = ICONS[id];
  return (
    <span className="pt-label" data-lane={id} title={text}>
      <Icon aria-hidden="true" />
      <span className="pt-label-text">{text}</span>
    </span>
  );
}

function Legend() {
  return (
    <span className="pt-legend" aria-label="Rating colours">
      <span>
        <i data-verdict="good" />
        {STRINGS.good}
      </span>
      <span>
        <i data-verdict="needs-work" />
        {STRINGS.needsWork}
      </span>
      <span>
        <i data-verdict="poor" />
        {STRINGS.poor}
      </span>
    </span>
  );
}
