import { MIN_EDIT_MS } from './edit-list.ts';

/**
 * A stretch of a lane whose regions take turns: two zooms, two speed-ups or two captions never cover the same moment,
 * because playback shows only one of each at a time. Every way a region's time changes (adding, dragging an edge,
 * moving it, typing a time) asks these helpers for the free room between its neighbours and stops at their edges, so
 * an overlap cannot be made. Original timeline, ms; pure and identical in Node and the browser.
 */
export interface Span {
  id: string;
  from: number;
  to: number;
}

export interface Room {
  low: number;
  high: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The free stretch around `time` between the other spans (`except` one), or undefined when `time` is inside one. */
export function roomAround(spans: readonly Span[], time: number, duration: number, except?: string): Room | undefined {
  let low = 0;
  let high = duration;
  for (const span of spans) {
    if (span.id === except) continue;
    if (span.to <= time) low = Math.max(low, span.to);
    else if (span.from > time) high = Math.min(high, span.from);
    else return undefined;
  }
  return { low, high };
}

/**
 * The room a span can grow or move in: up to its nearest neighbours. invariant: a neighbour it already overlaps
 * (a list saved before this rule) does not pin it in place; the overlap is resolved by `separateSpans` on save.
 */
function roomOf(spans: readonly Span[], own: Span, duration: number): Room {
  let low = 0;
  let high = duration;
  for (const span of spans) {
    if (span.id === own.id) continue;
    if (span.to <= own.from) low = Math.max(low, span.to);
    else if (span.from >= own.to) high = Math.min(high, span.from);
  }
  return { low, high };
}

/**
 * A new span over [from, to), clamped to the replay and to the free stretch around its start. Undefined when that
 * start is inside another span or what is left is shorter than MIN_EDIT_MS.
 */
export function placeSpan(spans: readonly Span[], from: number, to: number, duration: number): { from: number; to: number } | undefined {
  const start = clamp(Math.min(from, to), 0, duration);
  const end = clamp(Math.max(from, to), 0, duration);
  const room = roomAround(spans, start, duration);
  if (!room) return undefined;
  const placed = { from: Math.max(start, room.low), to: Math.min(end, room.high) };
  return placed.to - placed.from < MIN_EDIT_MS ? undefined : placed;
}

/**
 * One edge of a span moved to `time` (or the whole span, `move`, with `time` as its new start), stopping at the
 * neighbours' edges and never shorter than MIN_EDIT_MS. `exclusive` false: only the replay's ends bound it.
 */
export function retimeSpan(
  spans: readonly Span[],
  own: Span,
  { edge, time, duration, exclusive = true }: { edge: 'from' | 'to' | 'move'; time: number; duration: number; exclusive?: boolean },
): { from: number; to: number } {
  const { low, high } = exclusive ? roomOf(spans, own, duration) : { low: 0, high: duration };
  let { from, to } = own;
  if (edge === 'from') from = clamp(time, low, to - MIN_EDIT_MS);
  else if (edge === 'to') to = clamp(time, from + MIN_EDIT_MS, high);
  else {
    const length = to - from;
    from = clamp(time, low, Math.max(low, high - length));
    to = Math.min(high, from + length);
  }
  return { from, to };
}

/**
 * The spans in time order with no two overlapping: where one starts before the previous ends, the previous now ends
 * there. A span that starts within MIN_EDIT_MS of the previous one starts where that one ends instead, and is
 * dropped only if nothing of it is left (it was hidden behind the earlier one during playback anyway).
 */
export function separateSpans<T extends Span>(spans: readonly T[]): T[] {
  const ordered = [...spans].sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
  const out: T[] = [];
  for (const span of ordered) {
    const previous = out.at(-1);
    if (!previous || span.from >= previous.to) {
      out.push(span);
      continue;
    }
    if (span.from - previous.from >= MIN_EDIT_MS) {
      out[out.length - 1] = { ...previous, to: span.from };
      out.push(span);
    } else if (span.to - previous.to >= MIN_EDIT_MS) out.push({ ...span, from: previous.to });
  }
  return out;
}
