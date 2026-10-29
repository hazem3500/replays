import { useRef } from 'react';

import { usePlayheadProgress } from '../hooks/use-playhead-progress.ts';
import { useRibbonBrush } from '../hooks/use-ribbon-brush.ts';
import { usePlayer } from '../player.ts';
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
  marks,
  range,
  onRange,
  highlight,
  testId,
}: {
  duration: number;
  density?: readonly number[] | undefined;
  marks: readonly RibbonMark[];
  range: RibbonRange | undefined;
  onRange: (range: RibbonRange | undefined) => void;
  /** The mark of the row under the pointer or selected: raised and outlined, and its span bracketed. */
  highlight?: string | undefined;
  testId: string;
}) {
  const player = usePlayer();
  const span = Math.max(1, duration);
  const { brush, handlers } = useRibbonBrush(span, (time) => player.seek(time), onRange);
  const strip = useRef<HTMLDivElement>(null);
  usePlayheadProgress(strip, span);
  const lit = highlight ? marks.find((mark) => mark.id === highlight) : undefined;
  const shown = brush ?? range;
  return (
    <div ref={strip} className="time-ribbon" data-testid={testId} title={STRINGS.hint} aria-hidden="true" {...handlers}>
      {density ? <Density counts={density} /> : null}
      {marks.map((mark) => (
        <span
          key={mark.id}
          className="ribbon-mark"
          data-tone={mark.tone}
          data-lane={mark.lane}
          data-lit={mark.id === highlight || undefined}
          style={{
            left: `${(mark.at / span) * 100}%`,
            width: `max(var(--ribbon-mark-min), ${(Math.max(0, mark.end - mark.at) / span) * 100}%)`,
          }}
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
