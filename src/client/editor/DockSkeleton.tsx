import { FilmIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { editTimeline } from '../../shared/edit-timeline.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { stepKindName } from '../viewer/step-kinds.ts';
import { measureLabel } from './label-measure.ts';
import { useHasKeyboard } from '../hooks/use-has-keyboard.ts';
import { blockText } from './BlockLabel.tsx';
import { clipBox, clipRuns, keptLength, labelRoom, lengthLabel, segmentText, stepSegments } from './clip-segments.ts';
import { Durations } from './Durations.tsx';
import { BAR_TOOLS } from './bar-tools.ts';
import { laneRegions } from './lanes.tsx';
import { rulerTicks, tickLabel } from './ruler.ts';

const NO_STEPS: readonly ReplayStep[] = [];

/** invariant: Timeline.tsx's PAD, the room left and right of the track that keeps the trim edges easy to grab. */
const PAD = 14;
/**
 * invariant: what stands between the window's edge and the track's scale on each side (dock-layout.css and
 * editor-layout.css): the dock's 20 px padding, the timeline's 4 px inset and, on the left, the 36 px lane gutter.
 */
const TRACK_INSET = 20 * 2 + 4 * 2 + 36 + PAD * 2;
/** A clip step's inline padding (Timeline.tsx ClipSteps). */
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

/** The ruler's time labels over the empty dots band; the dots arrive with the editor. */
function RulerSkeleton({ duration, width }: { duration: number; width: number }) {
  const { tick, ticks } = rulerTicks(width, duration);
  return (
    <div className="tl-ruler">
      {ticks.map((time) => (
        <span key={time} className="tl-tick" style={{ left: at(time / duration) }}>
          <span className="tl-tick-label">{tickLabel(time, tick)}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The clip's step tints where the loaded clip draws them (a step that shows words or its kind's name), without the
 * words, so the editor's arrival only adds words and dots.
 */
function ClipStepsSkeleton({
  steps,
  trim,
  cuts,
  px,
}: {
  steps: readonly ReplayStep[];
  trim: { start: number; end: number };
  cuts: ReplayEdits['cuts'];
  px: number;
}) {
  const segments = stepSegments(steps, trim);
  const boxes = segments.map((segment, index) =>
    clipBox(segment.offset * px, (segment.offset + segment.length) * px, { first: index === 0, last: index === segments.length - 1 }),
  );
  const labels = segments.map((segment, index) => {
    const room = labelRoom(segment, trim.start, cuts);
    const inset = segment.length * px - (boxes[index]?.width ?? 0);
    return segmentText(segment, keptLength(segment, trim.start, cuts), room.length * px - inset, {
      pad: STEP_PAD,
      measure: measureLabel,
      fallback: stepKindName(segment.kind),
    });
  });
  const runs = clipRuns(
    segments,
    labels.map((label) => !label.text),
  );
  const inRun = new Set(runs.flatMap((run) => run.members));
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={segment.at}
          className="tl-clip-step"
          data-wait={segment.wait || undefined}
          data-blank={inRun.has(index) ? '' : undefined}
          style={{ left: `${boxes[index]?.left ?? 0}px`, width: `${boxes[index]?.width ?? 0}px` }}
        />
      ))}
      {runs.map((run) => {
        const box = clipBox(run.from * px, run.to * px, {
          first: run.members.includes(0),
          last: run.members.includes(segments.length - 1),
        });
        return <span key={run.from} className="tl-clip-run" style={{ left: `${box.left}px`, width: `${box.width}px` }} />;
      })}
    </>
  );
}

/** The clip lane: the kept clip with its step tints, its trim tabs and its cuts (Timeline.tsx); words arrive with the editor. */
function ClipSkeleton({
  duration,
  width,
  edits,
  steps,
}: {
  duration: number;
  width: number;
  edits: ReplayEdits | undefined;
  steps: readonly ReplayStep[];
}) {
  const trim = edits?.trim ?? { start: 0, end: duration };
  const px = width / duration;
  return (
    <>
      {trim.start > 0 ? <span className="tl-outside" style={{ left: 0, width: at(trim.start / duration) }} /> : null}
      {trim.end < duration ? <span className="tl-outside" style={{ left: at(trim.end / duration), right: 0 }} /> : null}
      <span className="tl-clip" style={{ left: at(trim.start / duration), width: span((trim.end - trim.start) / duration) }}>
        <ClipStepsSkeleton steps={steps} trim={trim} cuts={edits?.cuts ?? []} px={px} />
        <span className="tl-trim" data-edge="start">
          <span className="tl-trim-grip" />
        </span>
        <span className="tl-trim" data-edge="end">
          <span className="tl-trim-grip" />
        </span>
      </span>
      {(edits?.cuts ?? []).map((cut) => (
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

/** A lane for each effect the cached edits hold, with its blocks where the loaded lanes put them. */
function EffectLanesSkeleton({ edits, duration, px }: { edits: ReplayEdits; duration: number; px: number }) {
  return laneRegions(edits).map((lane) => (
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
  ));
}

/** The playhead at 0:00, where the loaded timeline starts it. */
function PlayheadSkeleton() {
  return (
    <div className="tl-playhead-layer">
      <div className="tl-playhead" style={{ transform: `translateX(${PAD}px)` }}>
        <span className="tl-playhead-knob" />
      </div>
    </div>
  );
}

/**
 * The desktop dock while the editor loads: layout and markup only, drawn with the loaded dock's own classes
 * (dock-layout.css) so nothing moves when it arrives. The bar with its labelled tool group and Add, "0:00.0 / total"
 * and what the cached edits leave; the ruler's labels; the clip at its height; a lane for each effect the cached edits
 * hold; the playhead at 0:00; the clip's step tints. The step dots and the clip's step words arrive with the editor.
 */
export function DockSkeleton({
  duration,
  edits,
  steps = NO_STEPS,
}: {
  duration: number | undefined;
  edits: ReplayEdits | undefined;
  /** The recording's steps once its bundle is in: the clip's step tints. */
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
            {known ? <RulerSkeleton duration={duration} width={width} /> : <div className="tl-ruler" />}
          </div>
          <div className="tl-lane" data-kind="clip" data-tall="">
            <span className="tl-gutter">
              <FilmIcon />
            </span>
            <div className="tl-track">{known ? <ClipSkeleton duration={duration} width={width} edits={edits} steps={steps} /> : null}</div>
          </div>
          {known && edits ? <EffectLanesSkeleton edits={edits} duration={duration} px={px} /> : null}
          {known ? <PlayheadSkeleton /> : null}
        </div>
      </div>
    </section>
  );
}
