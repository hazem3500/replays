import type { EditTimeline, ReplayHighlight } from './edits.ts';

/** A highlight's visible location on the edited playback timeline. A cut can split one period into many parts. */
export type ProjectedHighlight =
  | { id: string; kind: 'point'; at: number; label?: string }
  | { id: string; kind: 'period'; from: number; to: number; part: number; label?: string };

/**
 * Map saved source-time navigation marks onto playback. Points in trimmed or cut time disappear. Periods are
 * intersected with every kept piece first, so a cut splits the visible band rather than claiming removed time.
 * editTimeline handles speed changes, which makes the projected width match actual playback time.
 */
export function projectHighlights(highlights: readonly ReplayHighlight[] | undefined, timeline: EditTimeline): ProjectedHighlight[] {
  if (!highlights?.length) return [];
  const result: ProjectedHighlight[] = [];
  for (const highlight of highlights) {
    if (highlight.kind === 'point') {
      if (!timeline.isRemoved(highlight.at))
        result.push({
          id: highlight.id,
          kind: 'point',
          at: Math.round(timeline.toEdited(highlight.at)),
          ...(highlight.label ? { label: highlight.label } : {}),
        });
      continue;
    }
    let cursor = highlight.from;
    const kept: Array<{ from: number; to: number }> = [];
    for (const removed of timeline.removed) {
      if (removed.to <= cursor || removed.from >= highlight.to) continue;
      if (removed.from > cursor) kept.push({ from: cursor, to: Math.min(removed.from, highlight.to) });
      cursor = Math.max(cursor, removed.to);
      if (cursor >= highlight.to) break;
    }
    if (cursor < highlight.to) kept.push({ from: cursor, to: highlight.to });
    for (const [part, span] of kept.entries()) {
      const from = Math.round(timeline.toEdited(span.from));
      const to = Math.round(timeline.toEdited(span.to));
      if (to <= from) continue;
      result.push({ id: highlight.id, kind: 'period', from, to, part, ...(highlight.label ? { label: highlight.label } : {}) });
    }
  }
  return result.sort((a, b) => ('at' in a ? a.at : a.from) - ('at' in b ? b.at : b.from) || a.id.localeCompare(b.id));
}
