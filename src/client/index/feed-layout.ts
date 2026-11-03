import type { FeedEntry } from './Feed.tsx';
import { type FeedCalendar, groupByDay } from './feed.ts';

/**
 * The feed as one flat run of virtual items: a heading per day group (when grouped by time), then the group's
 * rows. A list row holds one entry; a grid row holds one entry per column, so a row is everything that shares a
 * line on screen and is measured as one.
 */
export type FeedRow =
  | { kind: 'head'; key: string; label: string }
  | { kind: 'row'; key: string; entries: readonly FeedEntry[]; last: boolean };

/** A day group: its heading's item (absent when not grouped), its rows' items, and whether any entry is a suite. */
export interface FeedGroup {
  key: string;
  label: string | undefined;
  head: number | undefined;
  rows: readonly number[];
  suites: boolean;
}

export const entryKey = (entry: FeedEntry) => `${entry.kind}:${entry.id}`;

export function entryTime(entry: FeedEntry) {
  return entry.kind === 'session' ? entry.summary.capturedAt : entry.suite.createdAt;
}

export function feedLayout(entries: readonly FeedEntry[], options: { grouped: boolean; columns: number; calendar?: FeedCalendar }) {
  const columns = Math.max(1, Math.floor(options.columns));
  const sections = options.grouped
    ? groupByDay([...entries], entryTime, undefined, options.calendar)
    : [{ label: undefined, items: [...entries] }];
  const rows: FeedRow[] = [];
  const groups: FeedGroup[] = [];
  for (const section of sections) {
    const key = section.label ?? 'all';
    let head: number | undefined;
    if (section.label !== undefined) {
      head = rows.length;
      rows.push({ kind: 'head', key: `head:${key}`, label: section.label });
    }
    const indexes: number[] = [];
    for (let at = 0; at < section.items.length; at += columns) {
      const chunk = section.items.slice(at, at + columns);
      const first = chunk[0];
      if (!first) continue;
      indexes.push(rows.length);
      rows.push({ kind: 'row', key: `row:${entryKey(first)}`, entries: chunk, last: at + columns >= section.items.length });
    }
    groups.push({ key, label: section.label, head, rows: indexes, suites: section.items.some((entry) => entry.kind === 'suite') });
  }
  return { rows, groups };
}

/** What a group's list draws: rendered rows, and one spacer for each run of rows that is not rendered. */
export type FeedSegment = { kind: 'row'; index: number } | { kind: 'spacer'; key: string; height: number };

/**
 * Spacer heights that keep a group's list exactly as tall as if every row were rendered. Each row's size counts the
 * gap after it, or the list's end padding for the group's last row (useFeedVirtualizer measures them that way). A
 * spacer is a grid line of its own, so it is followed by a gap like a row (or by the end padding when it is last):
 * that part of the skipped rows' sizes is already drawn by the layout and leaves the spacer.
 */
export function groupSegments(
  rows: readonly number[],
  rendered: ReadonlySet<number>,
  sizes: readonly number[],
  spacing: { gap: number; padEnd: number },
): FeedSegment[] {
  const segments: FeedSegment[] = [];
  let skipped = 0;
  let from: number | undefined;
  const flush = (last: boolean) => {
    if (from === undefined) return;
    const height = Math.max(0, skipped - (last ? spacing.padEnd : spacing.gap));
    segments.push({ kind: 'spacer', key: `spacer:${from}`, height });
    skipped = 0;
    from = undefined;
  };
  for (const index of rows) {
    if (rendered.has(index)) {
      flush(false);
      segments.push({ kind: 'row', index });
      continue;
    }
    from ??= index;
    skipped += sizes[index] ?? 0;
  }
  flush(true);
  return segments;
}
