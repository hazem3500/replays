/** One stretch of the original timeline and how it plays: removed (rate 0), kept at 1×, or sped up (rate 1/n). */
interface Piece {
  from: number;
  to: number;
  /** Edited ms at `from`. */
  start: number;
  /** Edited ms per original ms: 0 removed, 1 kept, 1/n played n× faster. */
  rate: number;
}

/** Original ↔ edited time for one edit list and replay duration. */
export interface EditTimeline {
  /** Edited length, ms. */
  duration: number;
  /** The original replay's length, ms. */
  originalDuration: number;
  /** Removed stretches of the original (trimmed ends and cuts, merged), ascending. */
  removed: Array<{ from: number; to: number }>;
  /**
   * Edited time at original time `time` (clamped to the replay). Inside a removed stretch it is the edited time
   * where that stretch was taken out, so everything in it lands on the same instant.
   */
  toEdited(time: number): number;
  /** Original time shown at edited time `time`: where a cut point resumes (the end of the removed stretch). */
  toOriginal(time: number): number;
  /** True when original time `time` is trimmed off or cut (the trim end itself counts as removed). */
  isRemoved(time: number): boolean;
}

/** `ranges` clipped to [0, duration], merged where they touch or overlap, ascending. */
export function mergeRanges(ranges: ReadonlyArray<{ from: number; to: number }>, duration: number) {
  const sorted = ranges
    .map((range) => ({ from: Math.max(0, Math.min(duration, range.from)), to: Math.max(0, Math.min(duration, range.to)) }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** What the timeline reads from an edit list: its trim, cuts and speed-ups. */
export interface TimelineEdits {
  trim?: { start: number; end: number } | undefined;
  cuts: ReadonlyArray<{ from: number; to: number }>;
  speeds?: ReadonlyArray<{ from: number; to: number; rate: number }> | undefined;
}

export function editTimeline(edits: TimelineEdits | undefined, duration: number): EditTimeline {
  const total = Math.max(0, duration);
  const trim = edits?.trim;
  const removed = mergeRanges(
    [
      ...(trim ? [{ from: 0, to: trim.start }] : []),
      ...(edits?.cuts ?? []),
      ...(trim && trim.end < total ? [{ from: trim.end, to: total }] : []),
    ],
    total,
  );
  const pieces: Piece[] = [];
  let at = 0;
  let edited = 0;
  const push = (from: number, to: number, rate: number) => {
    if (to <= from) return;
    pieces.push({ from, to, start: edited, rate });
    edited += (to - from) * rate;
  };
  // invariant: kept stretches play at 1× except inside a speed-up range; cuts and trims win over speed-ups.
  const speeds = (edits?.speeds ?? [])
    .map((range) => ({ from: Math.max(0, range.from), to: Math.min(total, range.to), rate: range.rate }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const keep = (from: number, to: number) => {
    let cursor = from;
    for (const range of speeds) {
      if (range.to <= cursor || range.from >= to) continue;
      const start = Math.max(cursor, range.from);
      push(cursor, start, 1);
      const end = Math.min(to, range.to);
      push(start, end, 1 / range.rate);
      cursor = end;
    }
    push(cursor, to, 1);
  };
  for (const range of removed) {
    keep(at, range.from);
    push(range.from, range.to, 0);
    at = range.to;
  }
  keep(at, total);
  const editedDuration = edited;
  const trimEnd = trim && trim.end < total ? trim.end : undefined;

  const pieceAt = (time: number) => {
    let low = 0;
    let high = pieces.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((pieces[middle]?.from ?? Infinity) <= time) low = middle;
      else high = middle - 1;
    }
    return pieces[low];
  };
  return {
    duration: editedDuration,
    originalDuration: total,
    removed,
    toEdited(time) {
      const clamped = Math.max(0, Math.min(total, Number.isFinite(time) ? time : 0));
      const piece = pieceAt(clamped);
      if (!piece) return 0;
      return Math.min(editedDuration, piece.start + (Math.min(clamped, piece.to) - piece.from) * piece.rate);
    },
    toOriginal(time) {
      const clamped = Math.max(0, Math.min(editedDuration, Number.isFinite(time) ? time : 0));
      // invariant: a cut point resolves to the first kept piece after the cut.
      let last: Piece | undefined;
      for (const piece of pieces) {
        if (piece.rate === 0) continue;
        last = piece;
        if (clamped < piece.start + (piece.to - piece.from) * piece.rate)
          return piece.from + Math.max(0, clamped - piece.start) / piece.rate;
      }
      return last ? last.to : (trimEnd ?? total);
    },
    isRemoved(time) {
      if (trimEnd !== undefined && time >= trimEnd) return true;
      return removed.some((range) => time >= range.from && time < range.to);
    },
  };
}
