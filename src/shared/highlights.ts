import type { EditTimeline, ReplayHighlight } from './edits.ts';

/** A highlight's visible location on the edited playback timeline. A cut can split one period into many parts. */
export type ProjectedHighlight =
  | { id: string; kind: 'point'; at: number; label?: string }
  | { id: string; kind: 'period'; from: number; to: number; part: number; label?: string };

function keptSpans(from: number, to: number, timeline: EditTimeline) {
  let cursor = from;
  const kept: Array<{ from: number; to: number }> = [];
  for (const removed of timeline.removed) {
    if (removed.to <= cursor || removed.from >= to) continue;
    if (removed.from > cursor) kept.push({ from: cursor, to: Math.min(removed.from, to) });
    cursor = Math.max(cursor, removed.to);
    if (cursor >= to) break;
  }
  if (cursor < to) kept.push({ from: cursor, to });
  return kept;
}

function projectOne(highlight: ReplayHighlight, timeline: EditTimeline): ProjectedHighlight[] {
  const label = highlight.label ? { label: highlight.label } : {};
  if (highlight.kind === 'point') {
    if (timeline.isRemoved(highlight.at)) return [];
    return [{ id: highlight.id, kind: 'point', at: Math.round(timeline.toEdited(highlight.at)), ...label }];
  }
  return keptSpans(highlight.from, highlight.to, timeline).flatMap((span, part): ProjectedHighlight[] => {
    const from = Math.round(timeline.toEdited(span.from));
    const to = Math.round(timeline.toEdited(span.to));
    return to <= from ? [] : [{ id: highlight.id, kind: 'period', from, to, part, ...label }];
  });
}

/**
 * Map saved source-time navigation marks onto playback. Points in trimmed or cut time disappear. Periods are
 * intersected with every kept piece first, so a cut splits the visible band rather than claiming removed time.
 * editTimeline handles speed changes, which makes the projected width match actual playback time.
 */
export function projectHighlights(highlights: readonly ReplayHighlight[] | undefined, timeline: EditTimeline): ProjectedHighlight[] {
  const result = (highlights ?? []).flatMap((highlight) => projectOne(highlight, timeline));
  return result.sort((a, b) => ('at' in a ? a.at : a.from) - ('at' in b ? b.at : b.from) || a.id.localeCompare(b.id));
}
