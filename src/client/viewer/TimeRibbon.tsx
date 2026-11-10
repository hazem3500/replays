import { ChevronDownIcon } from 'lucide-react';
import { useRef } from 'react';
import { formatClock } from '../../shared/replay.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { useRibbonHighlightMotion } from '../hooks/use-ribbon-highlight-motion.ts';
import { usePlayheadAria } from '../hooks/use-playhead-aria.ts';
import { usePlayheadProgress } from '../hooks/use-playhead-progress.ts';
import { useRibbonScrub } from '../hooks/use-ribbon-scrub.ts';
import { useRibbonBrush } from '../hooks/use-ribbon-brush.ts';
import { usePlayer } from '../player.ts';
import { toggleRibbonCollapsed, useRibbonCollapsed } from './ribbon-collapse.ts';
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

const STRINGS = {
  hint: 'Click to seek, drag the playhead to scrub, drag to show only that stretch',
  key: 'Click to seek · Drag the playhead to scrub · Drag to filter',
  keyCollapsed: 'Click to seek',
  toggle: 'Time ribbon',
};

/**
 * One strip on the scrubber's own domain (0 to the replay's duration), so a mark at 40 % here sits at 40 % of the seek
 * bar. It answers "when" at any density: a histogram of `density` (counts per equal slice), `marks` on top, the
 * stretch after the playhead veiled. A click seeks; a drag picks a range (`onRange`), which the panel filters by.
 */
export function TimeRibbon({
  duration,
  density,
  marks,
  range,
  onRange,
  highlight,
  testId,
  onHighlight,
}: {
  duration: number;
  density?: readonly number[] | undefined;
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
  const handle = useRef<HTMLSpanElement>(null);
  const scrub = useRibbonScrub(player, span, strip);
  usePlayheadProgress(strip, span);
  usePlayheadAria(handle, player);
  const lit = highlight ? marks.find((mark) => mark.id === highlight) : undefined;
  const highlightRef = useRibbonHighlightMotion(lit?.id, lit?.at ?? 0, lit?.end ?? 0, span);
  const shown = brush ?? range;
  const collapsed = useRibbonCollapsed();
  return (
    <div className="ribbon-overview" data-collapsed={collapsed || undefined}>
      <div className="ribbon-ticks-wrap" aria-hidden={collapsed || undefined}>
        <div className="ribbon-ticks">
          <span>{formatClock(0)}</span>
          <span>{formatClock(duration / 2)}</span>
          <span>{formatClock(duration)}</span>
        </div>
      </div>
      <div
        ref={strip}
        id={`${testId}-strip`}
        className="time-ribbon"
        data-testid={testId}
        title={collapsed ? STRINGS.keyCollapsed : STRINGS.hint}
        {...handlers}
      >
        {density ? <Density counts={density} /> : null}
        {marks.map((mark) => (
          <RibbonMarkTarget
            key={mark.id}
            mark={mark}
            span={span}
            highlighted={mark.id === highlight}
            onHighlight={onHighlight}
            focusable={!collapsed}
          />
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
        <span className="ribbon-now">
          <span
            ref={handle}
            className="ribbon-handle"
            data-ribbon-handle=""
            role="slider"
            tabIndex={collapsed ? -1 : 0}
            aria-hidden={collapsed || undefined}
            aria-label="Playhead"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={0}
            {...scrub}
          />
        </span>
      </div>
      <div className="ribbon-key">
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
        <span>{collapsed ? STRINGS.keyCollapsed : STRINGS.key}</span>
        <button
          type="button"
          className="ribbon-toggle"
          aria-label={STRINGS.toggle}
          aria-expanded={!collapsed}
          aria-controls={`${testId}-strip`}
          onClick={toggleRibbonCollapsed}
        >
          <ChevronDownIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RibbonMarkTarget({
  mark,
  span,
  highlighted,
  onHighlight,
  focusable,
}: {
  mark: RibbonMark;
  span: number;
  highlighted: boolean;
  onHighlight: ((id?: string) => void) | undefined;
  focusable: boolean;
}) {
  const player = usePlayer();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            tabIndex={focusable ? undefined : -1}
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
