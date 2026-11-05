import {
  ArrowLeftIcon,
  CaptionsIcon,
  EllipsisIcon,
  EyeOffIcon,
  PlayIcon,
  ScanIcon,
  ScissorsIcon,
  Undo2Icon,
  ZoomInIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { editTimeline } from '../../shared/edit-timeline.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import { Durations } from './Durations.tsx';
import { formatClock } from '../../shared/replay.ts';
import { cssVars } from '../lib/css-vars.ts';
import { laneRegions } from './lanes.tsx';
import { fitScale } from './phone-timeline.ts';
import { blockText, LANE_GLYPHS } from './BlockLabel.tsx';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { rulerTicks, tickLabel } from './ruler.ts';

/** The timeline's width before the page has laid out (a phone's), for a frame rendered outside a browser. */
const FALLBACK_WIDTH = 390;
/** Room a region's lane glyph and the gap after it take from its label, and its inline padding (PhoneLanes.tsx). */
const REGION_GLYPH_PX = 14;
const REGION_PAD_PX = 7;

const screenWidth = () => (typeof window === 'undefined' ? FALLBACK_WIDTH : window.innerWidth);

const TOOLS: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Cut', icon: <ScissorsIcon aria-hidden="true" /> },
  { label: 'Captions', icon: <CaptionsIcon aria-hidden="true" /> },
  { label: 'Blur', icon: <EyeOffIcon aria-hidden="true" /> },
  { label: 'Zoom', icon: <ZoomInIcon aria-hidden="true" /> },
  { label: 'More', icon: <EllipsisIcon aria-hidden="true" /> },
];

/** The phone scale as it opens: its time labels over the empty dots band; the dots arrive with the editor. */
function SkeletonScale({ duration, scale }: { duration: number; scale: number }) {
  const px = (time: number) => time * scale;
  const { tick, ticks } = rulerTicks(px(duration), duration);
  return (
    <div className="sk-phone-scale">
      {ticks.map((at) => (
        <span key={at} style={{ left: `${px(at)}px` }}>
          {tickLabel(at, tick)}
        </span>
      ))}
    </div>
  );
}

/** The clip lane as it opens: the kept clip at its rect (PhoneLanes.tsx); its step words arrive with the editor. */
function SkeletonClip({ duration, edits, scale }: { duration: number; edits: ReplayEdits | undefined; scale: number }) {
  const trim = edits?.trim ?? { start: 0, end: duration };
  return (
    <div className="sk-phone-lane" data-kind="clip">
      <span className="sk-phone-clip" style={{ left: `${trim.start * scale}px`, width: `${(trim.end - trim.start) * scale}px` }} />
    </div>
  );
}

/** A lane per effect the cached edits hold, its blocks with the words and glyph the loaded lanes show. */
function SkeletonRegions({ edits, scale }: { edits: ReplayEdits; scale: number }) {
  const px = (time: number) => time * scale;
  return laneRegions(edits).map((lane) => (
    <div key={lane.kind} className="sk-phone-lane">
      {lane.regions.map((region) => {
        const width = lane.kind === 'caption' ? Math.max(1, px(region.to - region.from) - 2) : Math.max(4, px(region.to - region.from));
        const text = blockText(region.label, width - REGION_GLYPH_PX, { pad: REGION_PAD_PX });
        return (
          <span
            key={region.id}
            className="sk-phone-region"
            data-kind={lane.kind}
            data-short={region.label !== '' && !text ? '' : undefined}
            style={{ left: `${px(region.from)}px`, width: `${width}px` }}
          >
            {text ? (
              <>
                <AnimatedIcon name={LANE_GLYPHS[lane.kind]} size={10} strokeWidth={2.25} className="sk-phone-glyph" />
                <span>{text}</span>
              </>
            ) : null}
          </span>
        );
      })}
    </div>
  ));
}

/** The phone timeline as it opens: the whole recording across the screen, 0:00 and the playhead at its left margin. */
function SkeletonLanes({ duration, edits }: { duration: number; edits: ReplayEdits | undefined }) {
  const scale = fitScale(screenWidth(), duration);
  const px = (time: number) => time * scale;
  return (
    <div className="sk-phone-track" style={cssVars({ '--span': `${px(duration)}px` })}>
      <SkeletonScale duration={duration} scale={scale} />
      <SkeletonClip duration={duration} edits={edits} scale={scale} />
      {edits ? <SkeletonRegions edits={edits} scale={scale} /> : null}
    </div>
  );
}

/**
 * The phone editor while it loads, at the loaded layout's geometry (editor.css's and phone-editor.css's phone rules,
 * repeated in skeleton.css): its header with the title, the recording's frame at the screen's width, the timeline's
 * bar and its lanes as they open with the playhead at 0:00, and the tools, drawn still and disabled so the editor
 * arrives without anything moving.
 */
export function PhoneEditorSkeleton({
  title,
  frame,
  duration,
  edits,
  progress,
}: {
  title: string;
  /** The recording's frame where the player fits it (ViewerSkeleton's PlayerSkeleton, with the poster or still). */
  frame: ReactNode;
  duration: number | undefined;
  edits: ReplayEdits | undefined;
  progress: ReactNode;
}) {
  const edited = duration !== undefined && edits ? editTimeline(edits, duration).duration : undefined;
  return (
    <>
      <header className="sk-phone-header">
        <span className="sk-phone-icon" aria-hidden="true">
          <ArrowLeftIcon aria-hidden="true" />
        </span>
        <div className="sk-phone-heading">
          <h1>{title}</h1>
          <span aria-hidden="true" />
        </div>
        <span className="sk-phone-icon" data-disabled="" aria-hidden="true">
          <Undo2Icon aria-hidden="true" />
        </span>
        <Button size="sm" className="sk-phone-export" disabled tabIndex={-1} aria-hidden="true">
          Export
        </Button>
        <span className="sk-phone-icon sk-phone-more" aria-hidden="true">
          <EllipsisIcon aria-hidden="true" />
        </span>
        {progress}
      </header>
      <section className="sk-phone-stage" aria-hidden="true">
        {frame}
      </section>
      <section className="sk-phone-dock" aria-hidden="true">
        <div className="sk-phone-bar">
          <span className="sk-phone-play">
            <PlayIcon aria-hidden="true" />
          </span>
          <span className="sk-phone-clock">0:00.0</span>
          {duration === undefined ? null : <span className="sk-phone-duration">/ {formatClock(duration)}</span>}
          {duration !== undefined && edited !== undefined && Math.round(edited) !== Math.round(duration) ? (
            <Durations original={duration} edited={edited} />
          ) : null}
          <span className="sk-phone-fit">
            <ScanIcon aria-hidden="true" />
          </span>
        </div>
        <p className="sk-phone-step-line" />
        <div className="sk-phone-lanes">
          {duration !== undefined && duration > 0 ? <SkeletonLanes duration={duration} edits={edits} /> : null}
        </div>
        <p className="sk-phone-hint">
          {edits && laneRegions(edits).length > 0 ? null : 'Captions, blur and zoom from the tools below go here'}
        </p>
        <div className="sk-phone-tools">
          {TOOLS.map((tool) => (
            <span key={tool.label}>
              {tool.icon}
              {tool.label}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
