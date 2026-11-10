import {
  ChevronDownIcon,
  CircleAlertIcon,
  GaugeIcon,
  GlobeIcon,
  HourglassIcon,
  LayoutPanelLeftIcon,
  MousePointerClickIcon,
  TimerIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useRef } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { usePlayheadAria } from '../../hooks/use-playhead-aria.ts';
import { useRibbonScrub } from '../../hooks/use-ribbon-scrub.ts';
import { usePlayer } from '../../player.ts';
import { toggleRibbonCollapsed } from '../ribbon-collapse.ts';
import type { TimelineTab } from '../../views/settings.ts';
import type { RibbonRange } from '../TimeRibbon.tsx';
import { type FrameBand, readingAt } from './frames.ts';
import { LaneMarkButton } from './LaneMarkButton.tsx';
import { clockLabel, clusterMarks, type Lane, type LaneId, type LaneMark, niceTicks } from './timeline-model.ts';

const ICONS = {
  interaction: MousePointerClickIcon,
  task: HourglassIcon,
  request: GlobeIcon,
  shift: LayoutPanelLeftIcon,
  fps: GaugeIcon,
  failed: CircleAlertIcon,
  /** The Network timeline's request-density lane. */
  density: GlobeIcon,
  /** The Network timeline's lane of slow requests, named by its icon since the lane says only "Slow". */
  slow: TimerIcon,
} as const;

/** A name in the shared gutter: a lane that is drawn, or the frame-rate plot. */
export type GutterId = LaneId | keyof typeof ICONS;
export interface GutterLane {
  id: GutterId;
  label: string;
}

export const TIMELINE_STRINGS = {
  hint: 'Click to seek. Drag the playhead to scrub. Drag across the timeline to filter the moments.',
  toggle: 'Timeline',
  frameRate: 'Frame rate',
};

const MAX_TICKS = 6;
const NARROW_PX = 420;
const NARROW_TICKS = 4;

const percent = (at: number, span: number) => `${(at / span) * 100}%`;

function LaneLabel({ id, text }: { id: GutterId; text: string }) {
  const Icon = ICONS[id];
  return (
    <span className="pt-label" data-lane={id} title={text}>
      <Icon aria-hidden="true" />
      <span className="pt-label-text">{text}</span>
    </span>
  );
}

export function LaneGutter({ lanes, withFrames }: { lanes: readonly GutterLane[]; withFrames: boolean }) {
  return (
    <div className="pt-gutter" aria-hidden="true">
      <span className="pt-axis-gap" />
      {lanes.map((lane) => (
        <LaneLabel key={lane.id} id={lane.id} text={lane.label} />
      ))}
      {withFrames ? <LaneLabel id="fps" text={TIMELINE_STRINGS.frameRate} /> : null}
    </div>
  );
}

/** The clock labels along the top and the gridlines behind the lanes, on the same ticks. */
export function TimeAxis({ span, width, hint = TIMELINE_STRINGS.hint }: { span: number; width: number; hint?: string }) {
  const ticks = niceTicks(span, width < NARROW_PX ? NARROW_TICKS : MAX_TICKS);
  return (
    <>
      <div className="pt-axis" title={hint} aria-hidden="true">
        {ticks.map((at) => (
          <span key={at} className="pt-tick" data-first={at === 0 || undefined} style={{ left: percent(at, span) }}>
            {clockLabel(at)}
          </span>
        ))}
      </div>
      <div className="pt-grid" aria-hidden="true">
        {ticks.map((at) => (
          <span key={at} style={{ left: percent(at, span) }} />
        ))}
      </div>
    </>
  );
}

export function LaneRows({
  lanes,
  span,
  width,
  lit,
  focusable,
  onLight,
  onPick,
  children,
}: {
  children?: ReactNode;
  lanes: readonly Lane[];
  span: number;
  width: number;
  lit: readonly string[];
  focusable: boolean;
  onLight: (ids: readonly string[]) => void;
  onPick: (mark: LaneMark) => void;
}) {
  return (
    <div className="pt-lanes">
      {children}
      {lanes.map((lane) => (
        <div key={lane.id} className="pt-lane" data-lane={lane.id} role="group" aria-label={lane.label}>
          {clusterMarks(lane.items, span, width).map((mark) => (
            <LaneMarkButton
              key={mark.id}
              mark={mark}
              span={span}
              width={width}
              lit={mark.items.some((item) => item.momentId && lit.includes(item.momentId))}
              focusable={focusable}
              onLight={onLight}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The filtered range (or the one being dragged) and the stretch covered by the marks that are lit. */
export function RangeAndLit({
  lanes,
  lit,
  span,
  shown,
  brushing,
}: {
  lanes: readonly Lane[];
  lit: readonly string[];
  span: number;
  shown: RibbonRange | undefined;
  brushing: boolean;
}) {
  const items = lanes.flatMap((lane) => lane.items.filter((item) => item.momentId && lit.includes(item.momentId)));
  const from = Math.min(...items.map((item) => item.at));
  const to = Math.max(...items.map((item) => item.end));
  return (
    <>
      {shown ? (
        <span
          className="ribbon-range"
          data-live={brushing ? '' : undefined}
          style={{ left: percent(shown.from, span), width: percent(shown.to - shown.from, span) }}
        />
      ) : null}
      {items.length ? (
        <span className="ribbon-lit" style={{ left: percent(from, span), width: `max(3px, ${percent(to - from, span)})` }} />
      ) : null}
    </>
  );
}

/** The crosshair under the pointer and its clock and frame-rate readout, drawn in the same column as the lanes. */
export function Crosshair({
  hover,
  frames,
  span,
  collapsed,
}: {
  hover: number | undefined;
  frames: readonly FrameBand[];
  span: number;
  collapsed: boolean;
}) {
  if (hover === undefined) return null;
  const reading = collapsed ? undefined : readingAt(frames, hover, span);
  return (
    <>
      <span className="pt-cursor" style={{ left: `${hover * 100}%` }} aria-hidden="true" />
      <span className="pt-readout" style={{ left: `clamp(34px, ${hover * 100}%, calc(100% - 34px))` }} aria-hidden="true">
        {formatClock(hover * span)}
        {reading?.fps === undefined ? '' : ` · ${Math.round(reading.fps)} fps`}
      </span>
    </>
  );
}

/** The veil over what has not played yet, and the playhead with its draggable, keyboard-operable handle. */
export function Playhead({ span, plot, collapsed }: { span: number; plot: RefObject<HTMLElement | null>; collapsed: boolean }) {
  const player = usePlayer();
  const handle = useRef<HTMLSpanElement>(null);
  const scrub = useRibbonScrub(player, span, plot);
  usePlayheadAria(handle, player);
  return (
    <>
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
    </>
  );
}

export function TimelineToggle({
  collapsed,
  tab = 'performance',
  controls = 'performance-timeline-plot',
  label = TIMELINE_STRINGS.toggle,
}: {
  collapsed: boolean;
  tab?: TimelineTab;
  controls?: string;
  label?: string;
}) {
  return (
    <div className="ribbon-key">
      <button
        type="button"
        className="ribbon-toggle"
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={() => toggleRibbonCollapsed(tab)}
      >
        <ChevronDownIcon aria-hidden="true" />
      </button>
    </div>
  );
}
