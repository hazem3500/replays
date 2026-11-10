import { formatDuration, type NetworkRow } from '../network/model.ts';
import type { LayoutShift } from '../performance.ts';
import type { Moment, Verdict } from './model.ts';
import { shiftVerdict } from './stats.ts';
import { BREAKDOWN_PARTS, frameNote, type BreakdownPart } from './why.ts';

export type LaneId = 'interaction' | 'task' | 'request' | 'shift' | 'failed';

/** One thing drawn on a lane, before nearby ones are merged. */
export interface LaneItem {
  id: string;
  lane: LaneId;
  at: number;
  end: number;
  verdict: Verdict;
  /** What it was: "Click", "Long task", "GET /api/cart", "Layout shift". */
  title: string;
  /** Its measure, read as text: "620 ms", "0.12". */
  value: string;
  /** The table row this is, when it is a moment. */
  momentId?: string;
  /** A shift's size from 0 to 1, drawn as the dot's width. */
  weight?: number;
  /** Drawn quietly: a shift that followed an input is expected and not counted. */
  quiet?: boolean;
  note?: string;
  /** An interaction's phases in ms, shown in its tooltip. */
  breakdown?: Readonly<Record<BreakdownPart, number>>;
}

export interface Lane {
  id: LaneId;
  label: string;
  items: LaneItem[];
}

/** Items that touch or overlap in pixels, drawn as one mark. */
export interface LaneMark {
  id: string;
  lane: LaneId;
  at: number;
  end: number;
  verdict: Verdict;
  items: LaneItem[];
}

export const LANE_LABELS: Readonly<Record<LaneId, string>> = {
  interaction: 'Interactions',
  task: 'Long tasks',
  request: 'Slow requests',
  shift: 'Layout shifts',
  failed: 'Failed requests',
};

/** The over-budget part of a long task starts here: every captured task is already past the 50 ms that makes it long. */
export const TASK_FLOOR_MS = 50;
/** Layout shift dots reach full size at this score. */
const SHIFT_FULL = 0.25;
const MIN_MARK_PX = 3;
const SHIFT_DOT_PX = 10;
const MERGE_GAP_PX = 2;

const RANK: Readonly<Record<Verdict, number>> = { good: 0, 'needs-work': 1, poor: 2 };

export const worstOf = (items: readonly { verdict: Verdict }[]): Verdict =>
  items.reduce<Verdict>((worst, item) => (RANK[item.verdict] > RANK[worst] ? item.verdict : worst), 'good');

/** A long task, or the long animation frame that explains it: the frame's own span and blocking time, the task's rating. */
function momentItem(moment: Moment): LaneItem {
  const { frame, interaction } = moment;
  if (moment.kind === 'task' && frame) {
    const note = frameNote(frame);
    return {
      id: moment.id,
      lane: 'task',
      at: frame.at,
      end: frame.at + frame.duration,
      verdict: moment.verdict,
      title: 'Long animation frame',
      value: formatDuration(frame.duration),
      momentId: moment.id,
      ...(note ? { note } : {}),
    };
  }
  return {
    id: moment.id,
    lane: moment.kind,
    at: moment.at,
    end: moment.end,
    verdict: moment.verdict,
    title: moment.kind === 'task' ? 'Long task' : moment.label,
    value: formatDuration(moment.value),
    momentId: moment.id,
    ...(interaction
      ? { breakdown: Object.fromEntries(BREAKDOWN_PARTS.map((part) => [part, interaction[part]])) as Record<BreakdownPart, number> }
      : {}),
  };
}

export function requestItem(row: NetworkRow): LaneItem {
  return {
    id: `request:${row.id}`,
    lane: 'request',
    at: row.at,
    end: row.end,
    verdict: 'needs-work',
    title: `${row.entry.method} ${row.name.path}`,
    value: formatDuration(row.measured ?? row.end - row.at),
  };
}

function shiftItem(shift: LayoutShift, index: number): LaneItem {
  return {
    id: `shift:${index}`,
    lane: 'shift',
    at: shift.at,
    end: shift.at,
    verdict: shiftVerdict(shift.value),
    title: 'Layout shift',
    value: shift.value.toFixed(3),
    weight: Math.min(1, shift.value / SHIFT_FULL),
    quiet: shift.hadRecentInput,
    ...(shift.hadRecentInput ? { note: 'Followed an input, so it is not counted' } : {}),
  };
}

/** The lanes with something on them, in reading order; a lane with no data is not drawn. */
export function buildLanes(moments: readonly Moment[], requests: readonly NetworkRow[], shifts: readonly LayoutShift[]): Lane[] {
  const lanes: Lane[] = [
    { id: 'interaction', label: LANE_LABELS.interaction, items: moments.filter((m) => m.kind === 'interaction').map(momentItem) },
    { id: 'task', label: LANE_LABELS.task, items: moments.filter((m) => m.kind === 'task').map(momentItem) },
    { id: 'request', label: LANE_LABELS.request, items: requests.filter((row) => row.slow).map(requestItem) },
    { id: 'shift', label: LANE_LABELS.shift, items: shifts.map(shiftItem) },
  ];
  return lanes.filter((lane) => lane.items.length > 0);
}

/** The pixels an item takes at least: a hairline would be invisible, so a mark never draws narrower. */
const minPx = (item: LaneItem) => (item.lane === 'shift' ? SHIFT_DOT_PX : MIN_MARK_PX);

/**
 * Merges items that touch or overlap once drawn at `width` pixels over `span` ms, so crowded stretches read as one mark
 * carrying a count instead of a pile. Sorted by start; a mark's span covers its members.
 */
export function clusterMarks(items: readonly LaneItem[], span: number, width: number): LaneMark[] {
  const perMs = Math.max(1, width) / Math.max(1, span);
  const marks: { items: LaneItem[]; from: number; to: number }[] = [];
  for (const item of items.toSorted((a, b) => a.at - b.at)) {
    const from = item.at * perMs;
    const to = from + Math.max(minPx(item), (item.end - item.at) * perMs);
    const last = marks.at(-1);
    if (last && from < last.to + MERGE_GAP_PX) {
      last.items.push(item);
      last.to = Math.max(last.to, to);
    } else marks.push({ items: [item], from, to });
  }
  return marks.map(({ items: members }) => {
    const [first] = members;
    return {
      id: members.map((member) => member.id).join('+'),
      lane: first?.lane ?? 'interaction',
      at: Math.min(...members.map((member) => member.at)),
      end: Math.max(...members.map((member) => member.end)),
      verdict: worstOf(members),
      items: members,
    };
  });
}

const TICK_STEPS_MS = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];

/** Round clock positions (whole seconds, then 5, 10, 15, 30 s and minutes) from 0 to `span`, at most `most` of them. */
export function niceTicks(span: number, most: number): number[] {
  const step = TICK_STEPS_MS.find((candidate) => span / candidate < most) ?? TICK_STEPS_MS.at(-1) ?? 1000;
  const ticks: number[] = [];
  for (let at = 0; at <= span; at += step) ticks.push(at);
  return ticks;
}

/** "0:14", "12:05": the axis and the verdict read whole seconds. */
export function clockLabel(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
