import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { useClockFrame, useClockState } from '../../hooks/use-clock.ts';
import { SPEEDS, type Speed } from '../../player.ts';
import { ViewerPlayButton } from '../../viewer/presentation.tsx';
import type { MeetingClock } from './clock.ts';
import type { Marker } from './tiles.ts';

export const TRANSPORT_STRINGS = {
  region: 'Shared playback',
  play: 'Play all recordings',
  pause: 'Pause all recordings',
  timeline: 'Shared timeline',
  speed: 'Playback speed',
  previous: 'Previous error',
  next: 'Next error',
} as const;

const SEEK_KEYS: Record<string, number> = {
  ArrowLeft: -1000,
  ArrowDown: -1000,
  ArrowRight: 1000,
  ArrowUp: 1000,
  PageDown: -10_000,
  PageUp: 10_000,
};
const MARKER_CAP = 300;

/** One transport for every tile; the playhead, readout and scrubber are written per frame, never re-rendered. */
export function MeetingTransport({
  clock,
  markers,
  probe,
  children,
}: {
  clock: MeetingClock;
  markers: Marker[];
  /** A row hovered in the diagnostics dock: where it sits on the shared timeline, in its tile's colour. */
  probe?: { at: number; colour: number } | undefined;
  children?: ReactNode;
}) {
  const status = useClockState(clock, (snapshot) => snapshot.status);
  const duration = useClockState(clock, (snapshot) => snapshot.duration);
  const speed = useClockState(clock, (snapshot) => snapshot.speed);
  const ready = duration > 0;

  const readout = useClockFrame<HTMLOutputElement>(clock, (element, time) => {
    const text = `${formatClock(time)} / ${formatClock(clock.getSnapshot().duration)}`;
    if (element.textContent !== text) element.textContent = text;
  });
  const range = useClockFrame<HTMLInputElement>(clock, (element, time) => {
    if (element.dataset.dragging) return;
    const total = clock.getSnapshot().duration;
    element.max = String(Math.max(1, total));
    element.value = String(time);
    element.style.setProperty('--progress', String(total ? time / total : 0));
    element.setAttribute('aria-valuetext', `${formatClock(time)} of ${formatClock(total)}`);
  });
  const jump = (direction: 1 | -1) => {
    const time = clock.getTime();
    const target = direction > 0 ? markers.find((marker) => marker.at > time + 50) : markers.findLast((marker) => marker.at < time - 50);
    if (target) clock.seek(target.at);
  };

  return (
    <section className="mt-transport" aria-label={TRANSPORT_STRINGS.region}>
      <div className="mt-transport-row">
        <ViewerPlayButton
          label={status === 'playing' ? TRANSPORT_STRINGS.pause : TRANSPORT_STRINGS.play}
          disabled={!ready}
          onClick={clock.toggle}
        >
          {status === 'playing' ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
        </ViewerPlayButton>
        <IconButton label={TRANSPORT_STRINGS.previous} size="icon-sm" disabled={!markers.length} onClick={() => jump(-1)}>
          <SkipBackIcon aria-hidden="true" />
        </IconButton>
        <IconButton label={TRANSPORT_STRINGS.next} size="icon-sm" disabled={!markers.length} onClick={() => jump(1)}>
          <SkipForwardIcon aria-hidden="true" />
        </IconButton>
        <output ref={readout} className="mt-readout" aria-live="off" />
        <div className="mt-roster-slot">{children}</div>
        <select
          className="mt-speed"
          aria-label={TRANSPORT_STRINGS.speed}
          value={speed}
          onChange={(event) => clock.setSpeed(Number(event.target.value) as Speed)}
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
      <div className="mt-scrubber">
        <MarkerTrack markers={markers} duration={duration} probe={probe} />
        <input
          ref={range}
          className="mt-range"
          type="range"
          aria-label={TRANSPORT_STRINGS.timeline}
          min={0}
          max={Math.max(1, duration)}
          step={100}
          defaultValue={0}
          disabled={!ready}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.dataset.dragging = '1';
            clock.beginScrub();
          }}
          onInput={(event) => {
            const value = Number(event.currentTarget.value);
            event.currentTarget.style.setProperty('--progress', String(duration ? value / duration : 0));
            clock.seek(value);
          }}
          onPointerUp={(event) => {
            delete event.currentTarget.dataset.dragging;
            clock.endScrub();
          }}
          onPointerCancel={(event) => {
            delete event.currentTarget.dataset.dragging;
            clock.endScrub(false);
          }}
          onKeyDown={(event) => {
            const step = SEEK_KEYS[event.key];
            if (event.key === ' ' || event.key === 'k') {
              event.preventDefault();
              clock.toggle();
            } else if (step || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              clock.seek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : clock.getTime() + step!);
            }
          }}
        />
      </div>
    </section>
  );
}

function MarkerTrack({
  markers,
  duration,
  probe,
}: {
  markers: Marker[];
  duration: number;
  probe: { at: number; colour: number } | undefined;
}) {
  if (!duration) return null;
  return (
    <div className="mt-markers" aria-hidden="true">
      {markers.slice(0, MARKER_CAP).map((marker) => (
        <i
          key={marker.id}
          title={`${marker.letter} · ${formatClock(marker.at)} · ${marker.label}`}
          style={{ left: `${(100 * marker.at) / duration}%`, '--tile': `var(--tile-${marker.colour + 1})` } as CSSProperties}
        />
      ))}
      {probe ? (
        <b
          className="mt-probe"
          style={{ left: `${(100 * probe.at) / duration}%`, '--tile': `var(--tile-${probe.colour + 1})` } as CSSProperties}
        />
      ) : null}
    </div>
  );
}
