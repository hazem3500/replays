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
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { cssVars } from '../lib/css-vars.ts';
import { laneRegions } from './lanes.tsx';
import { fitScale } from './phone-timeline.ts';
import { rulerTicks, tickLabel } from './ruler.ts';

/** The timeline's width before the page has laid out (a phone's), for a frame rendered outside a browser. */
const FALLBACK_WIDTH = 390;
/** A step segment or region narrower than this shows no label, as on the loaded timeline (PhoneLanes.tsx). */
const LABEL_PX = 44;

const TOOLS: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Trim', icon: <ScissorsIcon aria-hidden="true" /> },
  { label: 'Caption', icon: <CaptionsIcon aria-hidden="true" /> },
  { label: 'Blur', icon: <EyeOffIcon aria-hidden="true" /> },
  { label: 'Zoom', icon: <ZoomInIcon aria-hidden="true" /> },
  { label: 'More', icon: <EllipsisIcon aria-hidden="true" /> },
];

/** The phone timeline as it opens: fitted to the screen, 0:00 under the centre playhead. */
function SkeletonLanes({ duration, edits, steps }: { duration: number; edits: ReplayEdits | undefined; steps: readonly ReplayStep[] }) {
  const scale = fitScale(typeof window === 'undefined' ? FALLBACK_WIDTH : window.innerWidth, duration);
  const px = (time: number) => time * scale;
  const { tick, ticks } = rulerTicks(px(duration), duration);
  const trim = edits?.trim ?? { start: 0, end: duration };
  return (
    <div className="sk-phone-track" style={cssVars({ '--span': `${px(duration)}px` })}>
      <div className="sk-phone-scale">
        {ticks.map((at) => (
          <span key={at} style={{ left: `${px(at)}px` }}>
            {tickLabel(at, tick)}
          </span>
        ))}
      </div>
      <div className="sk-phone-lane" data-kind="clip">
        <span className="sk-phone-clip" style={{ left: `${px(trim.start)}px`, width: `${px(trim.end - trim.start)}px` }}>
          {steps.map((step, index) => {
            const next = steps[index + 1]?.at ?? trim.end;
            const width = px(Math.min(next, trim.end) - Math.max(step.at, trim.start));
            if (step.at >= trim.end || next <= trim.start || width <= 0) return null;
            return (
              <span
                key={`${step.at}-${index}`}
                style={{ left: `${px(Math.max(step.at, trim.start) - trim.start)}px`, width: `${width}px` }}
              >
                {width >= LABEL_PX ? step.label : null}
              </span>
            );
          })}
        </span>
      </div>
      {edits
        ? laneRegions(edits).map((lane) => (
            <div key={lane.kind} className="sk-phone-lane">
              {lane.regions.map((region) => (
                <span
                  key={region.id}
                  className="sk-phone-region"
                  data-kind={lane.kind}
                  style={{ left: `${px(region.from)}px`, width: `${Math.max(4, px(region.to - region.from))}px` }}
                >
                  {px(region.to - region.from) >= LABEL_PX ? <span>{region.label}</span> : null}
                </span>
              ))}
            </div>
          ))
        : null}
    </div>
  );
}

const NO_STEPS: readonly ReplayStep[] = [];

/**
 * The phone editor while it loads, at the loaded layout's geometry (editor.css's and phone-editor.css's phone rules,
 * repeated in skeleton.css): its header with the title, the recording's frame at the screen's width, the timeline's
 * bar and its lanes as they open under the centre playhead, and the tools, drawn still and disabled so the editor
 * arrives without anything moving.
 */
export function PhoneEditorSkeleton({
  title,
  frame,
  duration,
  edits,
  steps = NO_STEPS,
  progress,
}: {
  title: string;
  /** The recording's frame where the player fits it (ViewerSkeleton's PlayerSkeleton, with the poster or still). */
  frame: ReactNode;
  duration: number | undefined;
  edits: ReplayEdits | undefined;
  /** The recording's steps once its bundle is in: the clip's segments. */
  steps?: readonly ReplayStep[] | undefined;
  progress: ReactNode;
}) {
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
          <span className="sk-phone-fit">
            <ScanIcon aria-hidden="true" />
          </span>
        </div>
        <div className="sk-phone-lanes">
          {duration !== undefined && duration > 0 ? <SkeletonLanes duration={duration} edits={edits} steps={steps} /> : null}
        </div>
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
