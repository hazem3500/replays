import { ScanIcon } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { editTimeline } from '../../shared/edit-timeline.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { useLanesWidth, usePhoneTimeline } from '../hooks/use-phone-timeline.ts';
import { useThrottledValue } from '../hooks/use-throttled-value.ts';
import { cssVars } from '../lib/css-vars.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { Durations } from './Durations.tsx';
import { EditorClock, EditorPlayButton } from './EditorTransport.tsx';
import { PhoneLanes } from './PhoneLanes.tsx';
import { clampScale, fitScale, stepBoundaries, stepLineLabel, stepLineText, trackScale } from './phone-timeline.ts';
import { startPhoneScrub } from './phone-scrub.ts';
import { rulerTicks, tickLabel } from './ruler.ts';
import { type EditorAction, hasEffectLanes, type Selection, trimOf } from './state.ts';
import { ScaleContext, type TimelineScale } from './timeline-drag.ts';
import { TimelineStepDots } from './TimelineStepDots.tsx';

/** A step dot's target on a phone, for a finger (phone-editor.css sizes the same). */
const PHONE_DOT_PX = 32;
/** A mouse drag past this many px scrolls the lanes instead of tapping what it started on. */
const DRAG_PX = 4;

/** Mouse drags scroll the lanes as a finger does (touch scrolls natively); the click after a drag is swallowed. */
function dragToScroll(event: ReactPointerEvent<HTMLDivElement>) {
  const onHandle = event.target instanceof Element && event.target.closest('.phone-handle');
  if (event.pointerType !== 'mouse' || event.button !== 0 || onHandle) return;
  const scroller = event.currentTarget;
  const startX = event.clientX;
  const startLeft = scroller.scrollLeft;
  let dragged = false;
  const onMove = (next: PointerEvent) => {
    if (!dragged && Math.abs(next.clientX - startX) < DRAG_PX) return;
    dragged = true;
    scroller.scrollLeft = startLeft - (next.clientX - startX);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (dragged) window.addEventListener('click', (click) => click.stopPropagation(), { capture: true, once: true });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** The timeline's slim bar: play, the time over the recording's length, what the edits leave, and Fit after a pinch. */
function PhoneTimelineBar({
  duration,
  edited,
  zoomed,
  onFit,
  onPlayPause,
}: {
  duration: number;
  edited: number;
  zoomed: boolean;
  onFit: () => void;
  onPlayPause: () => void;
}) {
  return (
    <div className="phone-timeline-bar">
      <EditorPlayButton onSwitch={onPlayPause} />
      <span className="phone-time">
        <EditorClock />
        <span className="phone-duration">/ {formatClock(duration)}</span>
      </span>
      {Math.round(edited) === Math.round(duration) ? null : <Durations original={duration} edited={edited} />}
      <IconButton label="Fit the whole recording" className="phone-fit" disabled={!zoomed} onClick={onFit} data-testid="timeline-fit">
        <ScanIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/**
 * The scale over the lanes: tick labels, then a dot per step (the desktop ruler's) on the row under them. A press on
 * it seeks there and a drag scrubs, settling on a step start it ends near.
 */
function PhoneScale({
  timeline,
  scale,
  edits,
  steps,
}: {
  timeline: TimelineScale;
  scale: number;
  edits: ReplayEdits;
  steps: readonly ReplayStep[];
}) {
  const player = usePlayer();
  const { duration } = timeline;
  const { tick, ticks } = rulerTicks(duration * scale, duration);
  const kept = editTimeline(edits, duration);
  return (
    <div
      className="phone-scale"
      data-testid="phone-scale"
      onPointerDown={(event) => startPhoneScrub(event, { player, timeline, snaps: stepBoundaries(steps, duration), scale })}
    >
      {ticks.map((at) => (
        <span key={at} className="phone-tick" style={{ left: `${at * scale}px` }} aria-hidden="true">
          {tickLabel(at, tick)}
        </span>
      ))}
      <TimelineStepDots steps={steps} isRemoved={(time) => kept.isRemoved(time)} target={PHONE_DOT_PX} />
    </div>
  );
}

/** why: a scrub passes many steps; the live region names the one it settles on, at most this often. */
const STEP_ANNOUNCE_MS = 700;

/**
 * One quiet line over the lanes naming the step under the playhead ("Add the mug"), so the fitted clip reads at a
 * glance while its narrow blocks stay label-free. It follows a scrub; the live region announces where it settles.
 */
function PhoneStepLine({
  steps,
  edits,
  duration,
  width,
}: {
  steps: readonly ReplayStep[];
  edits: ReplayEdits;
  duration: number;
  width: number;
}) {
  const trim = trimOf(edits, duration);
  const label = usePlayhead((time) => stepLineLabel(steps, trim, time));
  const spoken = useThrottledValue(label, STEP_ANNOUNCE_MS);
  return (
    <p className="phone-step-line" aria-live="polite" data-testid="phone-step-line">
      <span aria-hidden="true">{stepLineText(label, width)}</span>
      <span className="visually-hidden">{spoken}</span>
    </p>
  );
}

/** The playhead for the keyboard and screen readers: a range input over the playhead line (its arrows seek). */
function PlayheadInput({ duration, inputRef }: { duration: number; inputRef: (input: HTMLInputElement | null) => void }) {
  const player = usePlayer();
  return (
    <input
      ref={inputRef}
      type="range"
      className="phone-playhead"
      min={0}
      max={Math.round(duration)}
      step={100}
      defaultValue={0}
      aria-label="Playhead"
      onChange={(event) => player.seek(Number(event.currentTarget.value))}
      onKeyDown={(event) => {
        // why: the input seeks with its own keys; the editor's shortcuts would seek a second time.
        if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
      }}
      data-testid="phone-playhead"
    />
  );
}

/**
 * The phone timeline: the whole recording across the screen from 0:00 at its left edge, with a playhead line that
 * moves along it as on the desktop; the scale over the lanes seeks and scrubs and carries the step dots (a tap names
 * the step over the picture, clear of the time). A pinch zooms in, and the lanes then scroll to follow the playhead.
 */
export function PhoneTimeline({
  duration,
  edited,
  edits,
  steps,
  selection,
  dispatch,
  onPlayPause,
}: {
  /** The original recording's length, the timeline's scale. */
  duration: number;
  /** What the edits leave. */
  edited: number;
  edits: ReplayEdits;
  /** The recording's steps: the scale's dots and the clip's segments. */
  steps: readonly ReplayStep[];
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  onPlayPause: () => void;
}) {
  const player = usePlayer();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [seek, setSeek] = useState<HTMLInputElement | null>(null);
  const [zoom, setZoom] = useState<number>();
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const width = useLanesWidth(scroller);
  const fit = fitScale(width || 390, duration);
  const scale = zoom === undefined ? fit : clampScale(zoom, fit);
  usePhoneTimeline(scroller, { player, seek, scale, fit, track, onScale: setZoom });
  const timeline = trackScale(duration, scale, track);
  return (
    <div className="phone-timeline" data-testid="timeline" data-ready={width > 0 || undefined}>
      <PhoneTimelineBar
        duration={duration}
        edited={edited}
        zoomed={zoom !== undefined}
        onFit={() => setZoom(undefined)}
        onPlayPause={onPlayPause}
      />
      <PhoneStepLine steps={steps} edits={edits} duration={duration} width={width || 390} />
      <div className="phone-lanes-frame">
        <div ref={setScroller} className="phone-lanes" onPointerDown={dragToScroll} data-testid="timeline-lanes">
          <div className="phone-lanes-content">
            <ScaleContext.Provider value={timeline}>
              <div ref={setTrack} className="phone-track" style={cssVars({ '--span': `${duration * scale}px` })}>
                <PhoneScale timeline={timeline} scale={scale} edits={edits} steps={steps} />
                <PhoneLanes duration={duration} scale={scale} edits={edits} steps={steps} selection={selection} dispatch={dispatch} />
                <span className="phone-snap-marker" aria-hidden="true" />
                <PlayheadInput duration={duration} inputRef={setSeek} />
              </div>
            </ScaleContext.Provider>
          </div>
        </div>
      </div>
      {hasEffectLanes(edits) ? null : (
        <p className="phone-lanes-hint" data-testid="phone-lanes-hint">
          Captions, blur and zoom from the tools below go here
        </p>
      )}
    </div>
  );
}
