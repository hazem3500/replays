import { FilmIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { editTimeline } from '../../shared/edit-timeline.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { useHasKeyboard } from '../hooks/use-has-keyboard.ts';
import { blockText, ClipStepLabel } from './BlockLabel.tsx';
import { lengthLabel, stepSegments } from './clip-segments.ts';
import { Durations } from './Durations.tsx';
import { BAR_TOOLS } from './editor-tools.ts';
import { measureLabel } from './label-measure.ts';
import { laneRegions } from './lanes.tsx';
import { rulerTicks, tickLabel } from './ruler.ts';
import { keptLength, labelRoom, placeStepDots, segmentText, stepMarks } from './timeline-marks.ts';

const NO_STEPS: readonly ReplayStep[] = [];

/** invariant: Timeline.tsx's PAD, the room left and right of the track that keeps the trim edges easy to grab. */
const PAD = 14;
/**
 * invariant: what stands between the window's edge and the track's scale on each side (dock-layout.css and
 * editor-layout.css): the dock's 20 px padding, the timeline's 4 px inset and, on the left, the 36 px lane gutter.
 */
const TRACK_INSET = 20 * 2 + 4 * 2 + 36 + PAD * 2;
/** Padding the clip's first and last step and every other step keep inside the clip (Timeline.tsx ClipSteps). */
const EDGE_STEP_PAD = 14;
const STEP_PAD = 8;
/** A region block's inline padding (TimelineRegion.tsx). */
const REGION_PAD = 8;
/** The recording before its length is known: an invisible stand-in that holds the readout's width. */
const UNKNOWN_TOTAL = 0;

/** A time's place on the track as CSS: a fraction of the scale between the track's padded ends. */
const at = (fraction: number) => `calc(${PAD}px + (100% - ${PAD * 2}px) * ${fraction})`;
const span = (fraction: number) => `calc((100% - ${PAD * 2}px) * ${fraction})`;

/** The loaded bar's play, timecode, labelled tools and Add, drawn disabled at the same rects (EditorChrome.tsx EditorDockBar). */
function BarSkeleton({ total, edited }: { total: number | undefined; edited: number | undefined }) {
  const hasKeyboard = useHasKeyboard();
  return (
    <div className="editor-bar">
      <div className="editor-bar-start">
        <Button
          variant="ghost"
          size="icon"
          disabled
          tabIndex={-1}
          className="text-[var(--text-secondary)] [&_svg:not([class*=size-])]:size-4 play-button text-foreground"
        >
          <AnimatedIcon name="play" className="filled-icon" />
        </Button>
        <span className="editor-time">
          <span className="editor-clock">0:00.0</span>
          <span className="editor-time-total" style={total === undefined ? { visibility: 'hidden' } : undefined}>
            / {formatClock(total ?? UNKNOWN_TOTAL)}
          </span>
        </span>
      </div>
      <div className="editor-bar-tools">
        {BAR_TOOLS.map((tool) => (
          <Button key={tool.id} variant="ghost" size="sm" className="editor-tool" disabled tabIndex={-1}>
            <AnimatedIcon name={tool.icon} />
            {tool.label}
            {hasKeyboard ? (
              <kbd className="editor-key" data-slot="key-suffix">
                {tool.key}
              </kbd>
            ) : null}
          </Button>
        ))}
        <span className="editor-bar-divider" />
        <Button size="sm" variant="ghost" className="editor-add-effect" disabled tabIndex={-1}>
          <AnimatedIcon name="plus" /> Add <AnimatedIcon name="chevron-down" />
        </Button>
      </div>
      <div className="editor-bar-end">
        {total !== undefined && edited !== undefined ? <Durations original={total} edited={edited} /> : null}
      </div>
    </div>
  );
}

/** The ruler's time labels and, once the steps are known, their dots in the band under them. */
function RulerSkeleton({
  duration,
  width,
  steps,
  edits,
}: {
  duration: number;
  width: number;
  steps: readonly ReplayStep[];
  edits: ReplayEdits | undefined;
}) {
  const { tick, ticks } = rulerTicks(width, duration);
  const kept = editTimeline(edits, duration);
  return (
    <div className="tl-ruler">
      {ticks.map((time) => (
        <span key={time} className="tl-tick" style={{ left: at(time / duration) }}>
          <span className="tl-tick-label">{tickLabel(time, tick)}</span>
        </span>
      ))}
      <span className="tl-steps">
        {placeStepDots(stepMarks(steps, duration), duration, width).map((dot) => (
          <span
            key={`${dot.index}-${dot.at}`}
            className="tl-step"
            data-removed={kept.isRemoved(dot.seek) || undefined}
            style={{ left: `calc(${at(dot.at / duration)} - 12px)` }}
          >
            <AnimatedIcon
              name="dot"
              size={20}
              strokeWidth={dot.kind === 'wait' ? 2.5 : 0}
              fill={dot.kind === 'wait' ? 'none' : 'currentColor'}
            />
          </span>
        ))}
      </span>
    </div>
  );
}

/** The clip lane: the kept clip with its steps' dividers and words, its trim tabs and its cuts (Timeline.tsx). */
function ClipSkeleton({
  duration,
  width,
  steps,
  edits,
}: {
  duration: number;
  width: number;
  steps: readonly ReplayStep[];
  edits: ReplayEdits | undefined;
}) {
  const trim = edits?.trim ?? { start: 0, end: duration };
  const cuts = edits?.cuts ?? [];
  const length = Math.max(1, trim.end - trim.start);
  const px = width / duration;
  const segments = stepSegments(steps, trim);
  return (
    <>
      {trim.start > 0 ? <span className="tl-outside" style={{ left: 0, width: at(trim.start / duration) }} /> : null}
      {trim.end < duration ? <span className="tl-outside" style={{ left: at(trim.end / duration), right: 0 }} /> : null}
      <span className="tl-clip" style={{ left: at(trim.start / duration), width: span(length / duration) }}>
        {segments.map((segment, index) => {
          const room = labelRoom(segment, trim.start, cuts);
          const pad = index === 0 || index === segments.length - 1 ? EDGE_STEP_PAD : STEP_PAD;
          return (
            <span
              key={segment.at}
              className="tl-clip-step"
              data-wait={segment.wait || undefined}
              style={{ left: `${(segment.offset / length) * 100}%`, width: `${(segment.length / length) * 100}%` }}
            >
              <span className="tl-clip-step-label" style={{ marginLeft: `${(room.skip / Math.max(1, segment.length)) * 100}%` }}>
                <ClipStepLabel
                  {...segmentText(segment, keptLength(segment, trim.start, cuts), room.length * px, { pad, measure: measureLabel })}
                />
              </span>
            </span>
          );
        })}
        <span className="tl-trim" data-edge="start">
          <span className="tl-trim-grip" />
        </span>
        <span className="tl-trim" data-edge="end">
          <span className="tl-trim-grip" />
        </span>
      </span>
      {cuts.map((cut) => (
        <RegionSkeleton
          key={cut.id}
          kind="cut"
          label={lengthLabel('Cut', cut.to - cut.from)}
          from={cut.from}
          to={cut.to}
          duration={duration}
          px={px}
        />
      ))}
    </>
  );
}

/** One block on a lane, at the loaded RegionBlock's rect and with the words it shows (TimelineRegion.tsx). */
function RegionSkeleton({
  kind,
  label,
  from,
  to,
  duration,
  px,
}: {
  kind: string;
  label: string;
  from: number;
  to: number;
  duration: number;
  px: number;
}) {
  const natural = (to - from) * px;
  const width = kind === 'caption' ? Math.max(1, natural - 2) : Math.max(6, natural);
  const text = blockText(label, width, { pad: REGION_PAD });
  const style: CSSProperties = {
    left: at(from / duration),
    width: kind === 'caption' ? `max(1px, ${span((to - from) / duration)} - 2px)` : `max(6px, ${span((to - from) / duration)})`,
  };
  return (
    <span className="tl-region" data-kind={kind} style={style}>
      <span className="tl-region-body" data-short={label !== '' && !text ? '' : undefined}>
        {text ? <span className="tl-region-label">{text}</span> : null}
      </span>
    </span>
  );
}

/**
 * The desktop dock while the editor loads, drawn with the loaded dock's own classes (dock-layout.css) so nothing moves
 * when it arrives: the bar with its labelled tool group and Add, "0:00.0 / total" and what the cached edits leave; the
 * ruler with its dots band; the clip at its height; and a lane for each effect the cached edits hold.
 */
export function DockSkeleton({
  duration,
  edits,
  steps = NO_STEPS,
}: {
  duration: number | undefined;
  edits: ReplayEdits | undefined;
  steps?: readonly ReplayStep[] | undefined;
}) {
  const known = duration !== undefined && duration > 0;
  const width = Math.max(0, (typeof window === 'undefined' ? 1280 : window.innerWidth) - TRACK_INSET);
  const px = known ? width / duration : 0;
  return (
    <section className="editor-dock" aria-hidden="true" data-testid="dock-skeleton">
      <BarSkeleton total={duration} edited={known && edits ? editTimeline(edits, duration).duration : undefined} />
      <div className="editor-timeline-content">
        {/* why: data-ready, so the playhead shows at 0:00 as it will once loaded (editor.css hides it on an unmeasured timeline). */}
        <div className="timeline" data-ready={known ? '' : undefined}>
          <div className="tl-ruler-row">
            <span className="tl-gutter-spacer" />
            {known ? <RulerSkeleton duration={duration} width={width} steps={steps} edits={edits} /> : <div className="tl-ruler" />}
          </div>
          <div className="tl-lane" data-kind="clip" data-tall="">
            <span className="tl-gutter">
              <FilmIcon />
            </span>
            <div className="tl-track">{known ? <ClipSkeleton duration={duration} width={width} steps={steps} edits={edits} /> : null}</div>
          </div>
          {known && edits
            ? laneRegions(edits).map((lane) => (
                <div key={lane.kind} className="tl-lane" data-kind={lane.kind}>
                  <span className="tl-gutter">{lane.icon}</span>
                  <div className="tl-track">
                    {lane.regions.map((region) => (
                      <RegionSkeleton
                        key={region.id}
                        kind={lane.kind}
                        label={region.label}
                        from={region.from}
                        to={region.to}
                        duration={duration}
                        px={px}
                      />
                    ))}
                  </div>
                </div>
              ))
            : null}
          {known ? (
            <div className="tl-playhead-layer">
              <div className="tl-playhead" style={{ transform: `translateX(${PAD}px)` }}>
                <span className="tl-playhead-knob" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
