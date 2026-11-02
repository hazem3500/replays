import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { useEndScrubOnUnmount } from '../../hooks/use-timeline-drags.ts';
import { usePlayer, usePlayhead } from '../../player.ts';
import type { TimelineScale } from './scale.ts';

/** Tick spacing: the smallest of these with at least ~72 px between labels. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

function tickLabel(ms: number, step: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  // Whole seconds read plainly ("0:01"); only the ticks between them carry a decimal ("0:01.5").
  const whole = step >= 1000 || ms % 1000 === 0;
  const text = whole ? String(Math.round(seconds)).padStart(2, '0') : seconds.toFixed(1).padStart(4, '0');
  return `${minutes}:${text}`;
}

/** The ruler: time ticks over the track column; press to seek, drag to scrub (phones: a range input instead). */
export function Ruler({
  scale,
  mobile,
  columnRef,
  onScrub,
}: {
  scale: TimelineScale;
  mobile: boolean;
  columnRef: (element: HTMLDivElement | null) => void;
  onScrub: (event: ReactPointerEvent) => void;
}) {
  const { duration } = scale;
  const tick = TICK_STEPS.find((step) => scale.width > 0 && (step / Math.max(1, duration)) * scale.width >= 72) ?? TICK_STEPS.at(-1)!;
  const ticks: number[] = [];
  if (scale.width > 0) for (let at = 0; at <= duration; at += tick) ticks.push(at);
  return (
    <div className="tl-ruler-row">
      <span className="tl-gutter-spacer" aria-hidden="true" />
      <div ref={columnRef} className="tl-ruler" data-testid="timeline-ruler" onPointerDown={mobile ? undefined : onScrub}>
        {mobile ? <MobileRulerSeek duration={duration} /> : null}
        {ticks.map((at) => (
          <span key={at} className="tl-tick" style={{ transform: `translateX(${scale.x(at)}px)` }}>
            <span className="tl-tick-label">{tickLabel(at, tick)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The phone ruler is the one seek surface, sharing the timeline scale and playhead. */
function MobileRulerSeek({ duration }: { duration: number }) {
  const player = usePlayer();
  const time = usePlayhead();
  useEndScrubOnUnmount();
  return (
    <input
      className="editor-seek editor-ruler-seek"
      type="range"
      min={0}
      max={duration}
      step={100}
      value={time}
      style={{ '--editor-seek-progress': `${duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0}%` } as CSSProperties}
      aria-label="Seek recording"
      aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        player.beginScrub();
      }}
      onPointerUp={() => player.endScrub()}
      onPointerCancel={() => player.endScrub()}
      onLostPointerCapture={() => player.endScrub()}
      onBlur={() => player.endScrub()}
      onChange={(event) => player.seek(event.currentTarget.valueAsNumber)}
    />
  );
}
