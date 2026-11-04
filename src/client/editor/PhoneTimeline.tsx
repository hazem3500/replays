import { ScanIcon } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { editTimeline } from '../../shared/edit-timeline.ts';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { useLanesWidth, usePhoneTimeline } from '../hooks/use-phone-timeline.ts';
import { cssVars } from '../lib/css-vars.ts';
import { usePlayer } from '../player.ts';
import { Durations, EditorClock, EditorPlayButton } from './EditorTransport.tsx';
import { PhoneLanes } from './PhoneLanes.tsx';
import { clampScale, fitScale, stepBoundaries, trackScale } from './phone-timeline.ts';
import { rulerTicks, tickLabel } from './ruler.ts';
import { type EditorAction, hasEffectLanes, type Selection } from './state.ts';
import { ScaleContext } from './timeline-drag.ts';
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

/** The scale over the lanes: tick labels, then a dot per step (the desktop ruler's) on the row under them. */
function PhoneScale({
  duration,
  scale,
  edits,
  steps,
  bubbleHost,
}: {
  duration: number;
  scale: number;
  edits: ReplayEdits;
  steps: readonly ReplayStep[];
  bubbleHost: HTMLElement | null;
}) {
  const { tick, ticks } = rulerTicks(duration * scale, duration);
  const kept = editTimeline(edits, duration);
  return (
    <div className="phone-scale">
      {ticks.map((at) => (
        <span key={at} className="phone-tick" style={{ left: `${at * scale}px` }} aria-hidden="true">
          {tickLabel(at, tick)}
        </span>
      ))}
      <TimelineStepDots steps={steps} isRemoved={(time) => kept.isRemoved(time)} target={PHONE_DOT_PX} bubbleHost={bubbleHost} />
    </div>
  );
}

/**
 * The phone timeline (the mobile video-editor pattern): a fixed centre playhead the full-width lanes scroll under,
 * so dragging the clips scrubs and the platform's momentum carries it; pinch zooms. Play and the time sit in its
 * slim bar; the scale over the lanes carries the step dots, as on the desktop ruler (a tap seeks and names the step
 * over the bar, clear of the track).
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
  const [bubbleHost, setBubbleHost] = useState<HTMLDivElement | null>(null);
  const width = useLanesWidth(scroller);
  const fit = fitScale(width || 390, duration);
  const scale = zoom === undefined ? fit : clampScale(zoom, fit);
  usePhoneTimeline(scroller, { player, seek, scale, fit, snaps: stepBoundaries(steps, duration), onScale: setZoom });
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
      <div ref={setBubbleHost} className="phone-step-bubble-host" />
      <div className="phone-lanes-frame">
        <span className="phone-snap-marker" aria-hidden="true" />
        <div ref={setScroller} className="phone-lanes" onPointerDown={dragToScroll} data-testid="timeline-lanes">
          <div className="phone-lanes-content">
            <ScaleContext.Provider value={timeline}>
              <div ref={setTrack} className="phone-track" style={cssVars({ '--span': `${duration * scale}px` })}>
                <PhoneScale duration={duration} scale={scale} edits={edits} steps={steps} bubbleHost={bubbleHost} />
                <PhoneLanes duration={duration} scale={scale} edits={edits} steps={steps} selection={selection} dispatch={dispatch} />
              </div>
            </ScaleContext.Provider>
          </div>
        </div>
        <input
          ref={setSeek}
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
      </div>
      {hasEffectLanes(edits) ? null : (
        <p className="phone-lanes-hint" data-testid="phone-lanes-hint">
          Captions, blur and zoom from the tools below go here
        </p>
      )}
    </div>
  );
}
