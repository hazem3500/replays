import { describe, expect, it } from 'vitest';

import type { FeedEntry } from '../src/client/index/Feed.tsx';
import { type FeedRow, feedLayout, type FeedSegment, groupSegments } from '../src/client/index/feed-layout.ts';
import { summarizeReplay } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const DAY = 86_400_000;

function session(id: string, daysAgo: number): FeedEntry {
  const summary = { ...summarizeReplay(replay(id)), capturedAt: new Date(Date.now() - daysAgo * DAY).toISOString() };
  return { kind: 'session', id, summary };
}

/** Lays segments out like a CSS grid list: items one per line, `gap` between lines, `padEnd` after the last. */
function laidOut(segments: readonly FeedSegment[], boxes: readonly number[], spacing: { gap: number; padEnd: number }) {
  const tops = new Map<number, number>();
  let y = 0;
  for (const [position, segment] of segments.entries()) {
    if (position > 0) y += spacing.gap;
    if (segment.kind === 'row') tops.set(segment.index, y);
    y += segment.kind === 'row' ? (boxes[segment.index] ?? 0) : segment.height;
  }
  return { height: y + spacing.padEnd, tops };
}

/** A grid row as its entries' ids, `|` marking a group's last row. */
const rowShape = (row: FeedRow | undefined) =>
  row?.kind === 'row' ? row.entries.map((entry) => entry.id).join('') + (row.last ? '|' : '') : '';

describe('virtual feed layout', () => {
  const spacing = { gap: 28, padEnd: 24 };
  const boxes = [300, 340, 300, 360, 300, 300, 320];
  const rows = boxes.map((_, index) => index);
  // invariant: useFeedVirtualizer measures a row as its box plus the gap after it, or the end padding when last.
  const sizes = boxes.map((box, index) => box + (index === boxes.length - 1 ? spacing.padEnd : spacing.gap));
  const full = sizes.reduce((sum, size) => sum + size, 0);
  const offset = (index: number) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0);

  it('keeps a group exactly as tall as all its rows, whichever rows are rendered', () => {
    const heights = [[], [0, 1], [2, 3], [5, 6], [0, 6], [1, 4], rows].map(
      (rendered) => laidOut(groupSegments(rows, new Set(rendered), sizes, spacing), boxes, spacing).height,
    );
    expect(heights).toEqual(heights.map(() => full));
  });

  it('places each rendered row where it would be with every row rendered', () => {
    const { tops } = laidOut(groupSegments(rows, new Set([3, 4, 6]), sizes, spacing), boxes, spacing);
    expect([...tops]).toEqual([
      [3, offset(3)],
      [4, offset(4)],
      [6, offset(6)],
    ]);
  });

  it('fills grid rows up to the column count without mixing days', () => {
    const entries = ['a', 'b', 'c', 'd', 'e'].map((id) => session(id, 0)).concat(['f', 'g'].map((id) => session(id, 400)));
    const { rows: items, groups } = feedLayout(entries, { grouped: true, columns: 4 });
    const shapeOf = (indexes: readonly number[]) => indexes.map((index) => rowShape(items[index]));
    expect(groups.map((group) => shapeOf(group.rows))).toEqual([['abcd', 'e|'], ['fg|']]);
  });
});
