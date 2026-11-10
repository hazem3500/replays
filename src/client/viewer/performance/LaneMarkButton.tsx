import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';

import { formatClock } from '../../../shared/replay.ts';
import { usePlayer } from '../../player.ts';
import { VERDICT_WORDS } from './model.ts';
import { LANE_LABELS, type LaneItem, type LaneMark, TASK_FLOOR_MS } from './timeline-model.ts';

const SHIFT_MIN_PX = 6;
const SHIFT_SPAN_PX = 8;
/** A count is written on a mark only when it is wide enough to hold two digits. */
const COUNT_MIN_PX = 20;

const NOUNS: Readonly<Record<LaneMark['lane'], string>> = {
  interaction: 'interactions',
  task: 'long tasks',
  request: 'slow requests',
  shift: 'layout shifts',
};

const duration = (item: LaneItem) => item.end - item.at;

/** The member to describe: the worst rating, then the longest. */
function worstItem(items: readonly LaneItem[]) {
  const rank = { good: 0, 'needs-work': 1, poor: 2 } as const;
  return items.reduce((worst, item) => ((rank[item.verdict] - rank[worst.verdict] || duration(item) - duration(worst)) > 0 ? item : worst));
}

function markLabel(mark: LaneMark) {
  const [single] = mark.items;
  const what = mark.items.length > 1 ? `${mark.items.length} ${NOUNS[mark.lane]}` : (single?.title ?? LANE_LABELS[mark.lane]);
  return `${formatClock(mark.at)} ${what}`;
}

/** The share of a lone long task's bar that is its first 50 ms, drawn as the tint before the full colour. */
function overShare(mark: LaneMark) {
  const [single] = mark.items;
  return mark.lane === 'task' && single && mark.items.length === 1
    ? Math.min(100, (TASK_FLOOR_MS / Math.max(1, duration(single))) * 100)
    : undefined;
}

function markStyle(mark: LaneMark, span: number) {
  const left = `${(mark.at / span) * 100}%`;
  if (mark.lane !== 'shift') return { left, width: `max(3px, ${((mark.end - mark.at) / span) * 100}%)` };
  const size = SHIFT_MIN_PX + Math.max(...mark.items.map((item) => item.weight ?? 0)) * SHIFT_SPAN_PX;
  return { left, width: size, height: size };
}

function Described({ mark }: { mark: LaneMark }) {
  const [single] = mark.items;
  if (mark.items.length === 1 && single) {
    return (
      <>
        <strong>{single.title}</strong>
        <span>
          {single.value} · <i className="pt-tip-dot" data-verdict={single.verdict} aria-hidden="true" />
          {VERDICT_WORDS[single.verdict]}
        </span>
        <span>{formatClock(single.at)}</span>
        {single.note ? <span>{single.note}</span> : null}
      </>
    );
  }
  const worst = worstItem(mark.items);
  return (
    <>
      <strong>
        {mark.items.length} {NOUNS[mark.lane]}
      </strong>
      <span>
        {formatClock(mark.at)} to {formatClock(mark.end)}
      </span>
      <span>
        Worst: {worst.value} <i className="pt-tip-dot" data-verdict={worst.verdict} aria-hidden="true" />
        {VERDICT_WORDS[worst.verdict]}
      </span>
    </>
  );
}

/** One mark on a lane: a rounded bar (a dot for a layout shift), rated in colour, a tooltip of what it was. */
export function LaneMarkButton({
  mark,
  span,
  width,
  lit,
  focusable,
  onLight,
  onPick,
}: {
  mark: LaneMark;
  span: number;
  width: number;
  lit: boolean;
  focusable: boolean;
  onLight: (ids: readonly string[]) => void;
  onPick: (mark: LaneMark) => void;
}) {
  const player = usePlayer();
  const ids = mark.items.flatMap((item) => (item.momentId ? [item.momentId] : []));
  const dot = mark.lane === 'shift';
  const pixels = ((mark.end - mark.at) / span) * width;
  const over = overShare(mark);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            tabIndex={focusable ? undefined : -1}
            aria-label={markLabel(mark)}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={() => onLight(ids)}
            onPointerLeave={() => onLight([])}
            onFocus={() => onLight(ids)}
            onBlur={() => onLight([])}
            onClick={(event) => {
              event.stopPropagation();
              player.seek(mark.at);
              onPick(mark);
            }}
          />
        }
        className="pt-mark"
        data-lane={mark.lane}
        data-verdict={mark.verdict}
        data-quiet={mark.items.every((item) => item.quiet) || undefined}
        data-cluster={mark.items.length > 1 || undefined}
        data-lit={lit || undefined}
        style={markStyle(mark, span)}
      >
        {over === undefined ? null : <i className="pt-over" style={{ width: `${over}%` }} />}
        {!dot && mark.items.length > 1 && pixels >= COUNT_MIN_PX ? <span className="pt-count">{mark.items.length}</span> : null}
      </TooltipTrigger>
      {/* why: below the mark, so the tooltip stays inside the timeline instead of covering the stats above it. */}
      <TooltipContent side="bottom">
        <span className="pt-tip">
          <Described mark={mark} />
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
