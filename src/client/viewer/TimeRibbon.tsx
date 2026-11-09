import { useRef } from 'react';
import { formatClock } from '../../shared/replay.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { useRibbonHighlightMotion } from '../hooks/use-ribbon-highlight-motion.ts';
import { usePlayheadProgress } from '../hooks/use-playhead-progress.ts';
import { useRibbonBrush } from '../hooks/use-ribbon-brush.ts';
import { usePlayer } from '../player.ts';
import type { FrameBand } from './performance/frames.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the ribbon's styles load with the lazy inspector chunk, not with every page.
import './time-ribbon.css';

export type RibbonTone = 'danger' | 'warning' | 'neutral' | 'success';
/**
 * `full` spans the ribbon (a failure), `top`/`bottom` are half lanes (tasks, interactions), `cap` a thin strip on top,
 * `tick` a short mark in the middle (one ordinary request when the recording is sparse).
 */
export type RibbonLane = 'full' | 'top' | 'bottom' | 'cap' | 'tick';

export interface RibbonMark {
  id: string;
  at: number;
  end: number;
  tone: RibbonTone;
  lane: RibbonLane;
  label?: string;
}

export interface RibbonRange {
  from: number;
  to: number;
}

const STRINGS = { hint: 'Click to seek, drag to show only that stretch' };

/**
 * One strip on the scrubber's own domain (0 to the replay's duration), so a mark at 40 % here sits at 40 % of the seek
 * bar. It answers "when" at any density: a histogram of `density` (counts per equal slice), `marks` on top, the
 * stretch after the playhead veiled. A click seeks; a drag picks a range (`onRange`), which the panel filters by.
 */
export function TimeRibbon({
  duration,
  density,
  fps,
  marks,
  range,
  onRange,
  highlight,
  testId,
  onHighlight,
}: {
  duration: number;
  density?: readonly number[] | undefined;
  /** A frame-rate lane along the bottom: one bar per recorded second, tall for smooth, coloured by verdict. */
  fps?: readonly FrameBand[] | undefined;
  marks: readonly RibbonMark[];
  range: RibbonRange | undefined;
  onRange: (range: RibbonRange | undefined) => void;
  /** The mark of the row under the pointer or selected: raised and outlined, and its span bracketed. */
  highlight?: string | undefined;
  testId: string;
  onHighlight?: (id?: string) => void;
}) {
  const player = usePlayer();
  const span = Math.max(1, duration);
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  const strip = useRef<HTMLDivElement>(null);
  usePlayheadProgress(strip, span);
  const lit = highlight ? marks.find((mark) => mark.id === highlight) : undefined;
  const highlightRef = useRibbonHighlightMotion(lit?.id, lit?.at ?? 0, lit?.end ?? 0, span);
  const shown = brush ?? range;
  return (
    <div className="ribbon-overview">
      <div className="ribbon-ticks">
        <span>{formatClock(0)}</span>
        <span>{formatClock(duration / 2)}</span>
        <span>{formatClock(duration)}</span>
      </div>
      <div
        ref={strip}
        className="time-ribbon"
        data-testid={testId}
        title={STRINGS.hint}
        data-fps={fps?.length ? '' : undefined}
        {...handlers}
      >
        {density ? <Density counts={density} /> : null}
        {fps?.length ? <FpsLane bands={fps} span={span} /> : null}
        {marks.map((mark) => (
          <RibbonMarkTarget key={mark.id} mark={mark} span={span} highlighted={mark.id === highlight} onHighlight={onHighlight} />
        ))}
        {shown ? (
          <span
            className="ribbon-range"
            data-live={brush ? '' : undefined}
            style={{ left: `${(shown.from / span) * 100}%`, width: `${((shown.to - shown.from) / span) * 100}%` }}
          />
        ) : null}
        {lit ? (
          <span
            ref={highlightRef}
            className="ribbon-lit"
            style={{
              left: `${(lit.at / span) * 100}%`,
              width: `max(var(--ribbon-mark-min), ${(Math.max(0, lit.end - lit.at) / span) * 100}%)`,
            }}
          />
        ) : null}
        <span className="ribbon-future" />
        <span className="ribbon-now" />
      </div>
      <div className="ribbon-key">
        {fps?.length ? (
          <>
            <span>
              <i data-tone="success" />
              Smooth
            </span>
            <span>
              <i data-tone="warning" />
              Choppy
            </span>
            <span>
              <i data-tone="danger" />
              Janky
            </span>
          </>
        ) : null}
        {testId === 'network-ribbon' ? (
          <>
            <span>
              <i data-tone="danger" />
              Failed
            </span>
            <span>
              <i data-tone="warning" />
              Slow
            </span>
          </>
        ) : null}
        <span>Click to seek · Drag to filter</span>
      </div>
    </div>
  );
}

function RibbonMarkTarget({
  mark,
  span,
  highlighted,
  onHighlight,
}: {
  mark: RibbonMark;
  span: number;
  highlighted: boolean;
  onHighlight: ((id?: string) => void) | undefined;
}) {
  const player = usePlayer();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${formatClock(mark.at)} ${mark.label ?? mark.tone}`}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={() => onHighlight?.(mark.id)}
            onBlur={() => onHighlight?.()}
            onPointerEnter={() => onHighlight?.(mark.id)}
            onPointerLeave={() => onHighlight?.()}
            onClick={(event) => {
              event.stopPropagation();
              player.seek(mark.at);
            }}
          />
        }
        className="ribbon-mark"
        data-tone={mark.tone}
        data-lane={mark.lane}
        data-lit={highlighted || undefined}
        style={{
          left: `${(mark.at / span) * 100}%`,
          width: `max(var(--ribbon-mark-min), ${(Math.max(0, mark.end - mark.at) / span) * 100}%)`,
        }}
      />
      <TooltipContent>
        {formatClock(mark.at)} {mark.label ?? mark.tone}
      </TooltipContent>
    </Tooltip>
  );
}

const SMOOTH_REFERENCE_FPS = 60;

function FpsLane({ bands, span }: { bands: readonly FrameBand[]; span: number }) {
  return (
    <div className="ribbon-fps" aria-hidden="true">
      {bands.map((band) => (
        <span
          key={band.at}
          data-verdict={band.verdict}
          style={{
            left: `${(band.at / span) * 100}%`,
            width: `${((band.end - band.at) / span) * 100}%`,
            height: `${Math.min(100, Math.max(20, (band.fps / SMOOTH_REFERENCE_FPS) * 100))}%`,
          }}
        />
      ))}
    </div>
  );
}

function Density({ counts }: { counts: readonly number[] }) {
  const most = Math.max(1, ...counts);
  // why: a square-root scale keeps one request visible next to a burst of sixty.
  const bars = counts.flatMap((count, bin) => (count ? [{ bin, height: Math.max(8, Math.sqrt(count / most) * 100) }] : []));
  return (
    <svg className="ribbon-density" viewBox={`0 0 ${counts.length} 100`} preserveAspectRatio="none" focusable="false">
      {bars.map(({ bin, height }) => (
        <rect key={bin} x={bin + 0.12} width={0.76} y={100 - height} height={height} />
      ))}
    </svg>
  );
}
