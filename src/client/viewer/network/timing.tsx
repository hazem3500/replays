import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { useElementWidth } from '../../hooks/use-element-width.ts';
import { usePlayhead } from '../../player.ts';
import { clampDomain, spanPercent, timeScale, type TimeDomain, type TimeScale } from '../time-axis.ts';
import { formatDuration, type NetworkRow } from './model.ts';

const STRINGS = {
  ruler: 'Timing axis. Drag to zoom; double-click to reset.',
  reset: 'Reset',
  zoomed: (domain: TimeDomain) => `${formatClock(domain.from)} to ${formatClock(domain.to)}`,
  unknown: 'duration unknown',
  bar: (row: NetworkRow) =>
    `${formatClock(row.at)} · ${row.timing.measured === undefined ? STRINGS.unknown : formatDuration(row.timing.measured)}`,
};
/** Ticks need about this much room each so labels never touch. */
const TICK_SPACING = 72;
/** A drag shorter than this is a click, not a zoom. */
const DRAG_THRESHOLD = 4;

/** The pointer's x inside the element, clamped to it. */
function local(event: ReactPointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(box.width, event.clientX - box.left));
}

/** One request's bar(s) on the shared axis: split at cuts, never thinner than --waterfall-bar-min-width. */
export function TimingCell({ row, scale }: { row: NetworkRow; scale: TimeScale }) {
  const active = usePlayhead((time) => !row.failed && row.at <= time && time < row.end);
  const state = row.failed ? 'failed' : active ? 'active' : 'done';
  const segments = row.timing.segments.length ? row.timing.segments : [{ from: row.at, to: row.at }];
  return (
    <span className="net-timing" data-state={state} title={STRINGS.bar(row)}>
      {segments.map((segment, index) => {
        if (segment.to < scale.domain.from || segment.from > scale.domain.to) return null;
        const span = spanPercent(scale, segment.from, segment.to);
        return (
          <span
            key={index}
            className="net-timing-bar"
            data-unknown={row.timing.measured === undefined || undefined}
            style={{ '--bar-left': `${span.left}%`, '--bar-width': `${span.width}%` } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

/**
 * The Timing header: ticks on the shared axis instead of a bare start and end. Dragging across it selects a range to zoom the
 * column (and filter the rows) to; double-click, or the Reset chip, goes back to the whole replay.
 */
export function TimingRuler({
  domain,
  bounds,
  onZoom,
}: {
  domain: TimeDomain;
  bounds: TimeDomain;
  onZoom: (domain: TimeDomain | undefined) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const width = useElementWidth(element, 240);
  const scale = timeScale(domain, width);
  const ticks = scale.ticks(Math.max(2, Math.floor(width / TICK_SPACING)));
  const drag = useRef<{ start: number; pointer: number } | undefined>(undefined);
  const [brush, setBrush] = useState<{ from: number; to: number } | undefined>(undefined);
  const zoomed = domain.from > bounds.from || domain.to < bounds.to;
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = undefined;
    setBrush(undefined);
    if (!start) return;
    const x = local(event);
    if (Math.abs(x - start.start) < DRAG_THRESHOLD) return;
    onZoom(clampDomain({ from: scale.ms(Math.min(start.start, x)), to: scale.ms(Math.max(start.start, x)) }, bounds));
  };
  return (
    <div className="net-ruler" data-zoomed={zoomed || undefined}>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: drag-to-zoom is a pointer shortcut; the toolbar filters and Reset cover the keyboard. */}
      <div
        ref={element}
        className="net-ruler-track"
        role="img"
        aria-label={STRINGS.ruler}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { start: local(event), pointer: event.pointerId };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const x = local(event);
          if (Math.abs(x - start.start) >= DRAG_THRESHOLD) setBrush({ from: Math.min(start.start, x), to: Math.max(start.start, x) });
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          drag.current = undefined;
          setBrush(undefined);
        }}
        onDoubleClick={() => onZoom(undefined)}
      >
        {ticks.map((tick) => (
          <span key={tick.ms} className="net-ruler-tick" style={{ '--tick-x': `${tick.x}px` } as CSSProperties}>
            {tick.label}
          </span>
        ))}
        {brush ? (
          <span
            className="net-ruler-brush"
            style={{ '--brush-x': `${brush.from}px`, '--brush-width': `${brush.to - brush.from}px` } as CSSProperties}
          />
        ) : null}
      </div>
      {zoomed ? (
        <button type="button" className="net-ruler-reset" onClick={() => onZoom(undefined)}>
          <span className="net-ruler-range">{STRINGS.zoomed(domain)}</span>
          <span aria-hidden="true">·</span>
          {STRINGS.reset}
        </button>
      ) : null}
    </div>
  );
}
