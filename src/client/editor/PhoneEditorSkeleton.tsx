import {
  ArrowLeftIcon,
  CaptionsIcon,
  EllipsisIcon,
  EyeOffIcon,
  FilmIcon,
  PlayIcon,
  ScissorsIcon,
  Undo2Icon,
  ZoomInIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock } from '../../shared/replay.ts';
import { cssVars } from '../lib/css-vars.ts';
import { laneRegions } from './lanes.tsx';
import { rulerTicks, tickLabel } from './ruler.ts';

/** The phone track's inner width is the viewport less the dock padding, gutter, timeline inset and track padding. */
const TRACK_INSET = 20 + 28 + 24 + 28;
const FALLBACK_TRACK_WIDTH = 290;

const TOOLS: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Trim', icon: <ScissorsIcon aria-hidden="true" /> },
  { label: 'Caption', icon: <CaptionsIcon aria-hidden="true" /> },
  { label: 'Blur', icon: <EyeOffIcon aria-hidden="true" /> },
  { label: 'Zoom', icon: <ZoomInIcon aria-hidden="true" /> },
  { label: 'More', icon: <EllipsisIcon aria-hidden="true" /> },
];

function trackWidth() {
  return typeof window === 'undefined' ? FALLBACK_TRACK_WIDTH : Math.max(0, window.innerWidth - TRACK_INSET);
}

/** A stretch of the recording as the track's inset-aware position (see .sk-phone-span). */
function span(from: number, to: number, duration: number) {
  const clamp = (ms: number) => Math.min(Math.max(ms, 0), duration) / duration;
  return cssVars({ '--from': clamp(from), '--span': clamp(to) - clamp(from) });
}

/** Whether the timeline labels a region this long: narrow regions hide it, captions need room for their text. */
function labelFits(kind: string, length: number, duration: number) {
  const natural = (length / duration) * trackWidth();
  return kind === 'caption' ? natural - 2 >= 56 : natural >= 44;
}

function Lane({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="sk-phone-lane">
      <span className="sk-phone-gutter">{icon}</span>
      <div className="sk-phone-track">{children}</div>
    </div>
  );
}

/** The phone timeline as it will load: the ruler's real ticks, the clip at its trim, and each lane's regions. */
function SkeletonTimeline({ duration, edits }: { duration: number | undefined; edits: ReplayEdits | undefined }) {
  const known = duration !== undefined && duration > 0;
  const { tick, ticks } = known ? rulerTicks(trackWidth(), duration) : { tick: 1000, ticks: [] };
  const trim = edits?.trim;
  const clip = known && trim ? span(trim.start, trim.end, duration) : span(0, 1, 1);
  return (
    <div className="sk-phone-timeline">
      <div className="sk-phone-ruler-row">
        <span />
        <div className="sk-phone-ruler">
          {known
            ? ticks.map((at) => (
                <span key={at} className="sk-phone-tick" style={span(at, at, duration)}>
                  <span>{tickLabel(at, tick)}</span>
                </span>
              ))
            : null}
          <span className="sk-phone-seek" />
        </div>
      </div>
      <Lane icon={<FilmIcon aria-hidden="true" />}>
        <span className="sk-phone-clip sk-phone-span" style={clip}>
          <span className="sk-phone-handle" />
          Recording
          <span className="sk-phone-handle" />
        </span>
      </Lane>
      {edits
        ? laneRegions(edits).map((lane) => (
            <Lane key={lane.kind} icon={lane.icon}>
              {known
                ? lane.regions.map((item) => (
                    <span
                      key={item.id}
                      className="sk-phone-region sk-phone-span"
                      data-kind={lane.kind}
                      style={span(item.from, item.to, duration)}
                    >
                      {labelFits(lane.kind, item.to - item.from, duration) ? <span>{item.label}</span> : null}
                    </span>
                  ))
                : null}
            </Lane>
          ))
        : null}
      <span className="sk-phone-playhead" />
    </div>
  );
}

/**
 * The phone editor while it loads, at the loaded layout's geometry (editor.css's phone section, repeated in
 * skeleton.css): its header with the title, the recording's frame where the player fits it, and the dock's
 * transport, timeline and tools, drawn still and disabled so the editor arrives without anything moving.
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
        <div className="sk-phone-playback">
          <span className="sk-phone-play">
            <PlayIcon aria-hidden="true" />
          </span>
          <span className="sk-phone-clock">0:00.0</span>
          {duration === undefined ? null : <span className="sk-phone-duration">/ {formatClock(duration)}</span>}
        </div>
        <SkeletonTimeline duration={duration} edits={edits} />
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
