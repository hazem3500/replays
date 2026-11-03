import { ScanIcon } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import type { ReplayEdits } from '../../shared/edits.ts';
import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import { useLanesWidth, usePhoneTimeline } from '../hooks/use-phone-timeline.ts';
import { cssVars } from '../lib/css-vars.ts';
import { usePlayer } from '../player.ts';
import { Durations, EditorClock, EditorPlayButton } from './EditorTransport.tsx';
import { PhoneLanes } from './PhoneLanes.tsx';
import { clampScale, fitScale, stepBoundaries } from './phone-timeline.ts';
import { rulerTicks, tickLabel } from './ruler.ts';
import type { EditorAction, Selection } from './state.ts';

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

/**
 * The phone timeline (the mobile video-editor pattern): a fixed centre playhead the full-width lanes scroll under,
 * so dragging the clips scrubs and the platform's momentum carries it; pinch zooms. Play and the time sit in its
 * slim bar; there is no separate ruler or scrub row.
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
  steps: readonly ReplayStep[];
  selection: Selection;
  dispatch: (action: EditorAction) => void;
  onPlayPause: () => void;
}) {
  const player = usePlayer();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [seek, setSeek] = useState<HTMLInputElement | null>(null);
  const [zoom, setZoom] = useState<number>();
  const width = useLanesWidth(scroller);
  const fit = fitScale(width || 390, duration);
  const scale = zoom === undefined ? fit : clampScale(zoom, fit);
  usePhoneTimeline(scroller, { player, seek, scale, fit, snaps: stepBoundaries(steps, duration), onScale: setZoom });
  const { tick, ticks } = rulerTicks(duration * scale, duration);
  return (
    <div className="phone-timeline" data-testid="timeline" data-ready={width > 0 || undefined}>
      <div className="phone-timeline-bar">
        <EditorPlayButton onSwitch={onPlayPause} />
        <span className="phone-time">
          <EditorClock />
          <span className="phone-duration">/ {formatClock(duration)}</span>
        </span>
        {Math.round(edited) === Math.round(duration) ? null : <Durations original={duration} edited={edited} />}
        <IconButton
          label="Fit the whole recording"
          className="phone-fit"
          disabled={zoom === undefined}
          onClick={() => setZoom(undefined)}
          data-testid="timeline-fit"
        >
          <ScanIcon aria-hidden="true" />
        </IconButton>
      </div>
      <div className="phone-lanes-frame">
        <span className="phone-snap-marker" aria-hidden="true" />
        <div ref={setScroller} className="phone-lanes" onPointerDown={dragToScroll} data-testid="timeline-lanes">
          <div className="phone-lanes-content">
            <div className="phone-track" style={cssVars({ '--span': `${duration * scale}px` })}>
              <div className="phone-scale" aria-hidden="true">
                {ticks.map((at) => (
                  <span key={at} style={{ left: `${at * scale}px` }}>
                    {tickLabel(at, tick)}
                  </span>
                ))}
              </div>
              <PhoneLanes duration={duration} scale={scale} edits={edits} steps={steps} selection={selection} dispatch={dispatch} />
            </div>
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
    </div>
  );
}
