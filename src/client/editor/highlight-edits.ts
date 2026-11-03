import { MIN_EDIT_MS, type ReplayEdits, type ReplayHighlight } from '../../shared/edits.ts';

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(high, Math.max(low, value)));

function nextHighlightId(edits: ReplayEdits) {
  const taken = new Set((edits.highlights ?? []).map((highlight) => highlight.id));
  for (let index = 1; ; index++) if (!taken.has(`highlight-${index}`)) return `highlight-${index}`;
}

export function addPointHighlight(edits: ReplayEdits, at: number, duration: number) {
  const time = clamp(at, 0, duration);
  const existing = edits.highlights?.find((highlight) => highlight.kind === 'point' && highlight.at === time);
  if (existing) return { edits, id: existing.id };
  const id = nextHighlightId(edits);
  const highlight: ReplayHighlight = { id, kind: 'point', at: time };
  return { edits: { ...edits, highlights: [...(edits.highlights ?? []), highlight] }, id };
}

export function addPeriodHighlight(edits: ReplayEdits, from: number, to: number, duration: number) {
  const start = clamp(Math.min(from, to), 0, duration);
  const end = clamp(Math.max(from, to), 0, duration);
  if (end - start < MIN_EDIT_MS) return;
  const id = nextHighlightId(edits);
  const highlight: ReplayHighlight = { id, kind: 'period', from: start, to: end };
  return { edits: { ...edits, highlights: [...(edits.highlights ?? []), highlight] }, id };
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function withHighlightLabel<T extends { label?: string }>(next: T, label: string | undefined) {
  return label ? { ...next, label } : (({ label: _label, ...rest }) => rest)(next);
}

export function updateHighlight(edits: ReplayEdits, id: string, patch: Partial<ReplayHighlight>, duration: number): ReplayEdits {
  return {
    ...edits,
    highlights: (edits.highlights ?? []).map((highlight) => {
      if (highlight.id !== id) return highlight;
      const label = Object.hasOwn(patch, 'label') ? patch.label?.trim().slice(0, 120) : highlight.label;
      if (highlight.kind === 'point') {
        const at = finiteOr(patch.kind === 'point' ? patch.at : undefined, highlight.at);
        return withHighlightLabel({ ...highlight, at: clamp(at, 0, duration) }, label);
      }
      const from = finiteOr(patch.kind === 'period' ? patch.from : undefined, highlight.from);
      const to = finiteOr(patch.kind === 'period' ? patch.to : undefined, highlight.to);
      const start = clamp(from, 0, Math.max(0, duration - MIN_EDIT_MS));
      return withHighlightLabel({ ...highlight, from: start, to: clamp(to, start + MIN_EDIT_MS, duration) }, label);
    }),
  };
}

/**
 * A highlight dragged or nudged on the timeline: a point's marker (`at`), one end of a period, or a whole period
 * (`move`, with `time` as its new start, keeping its length). Clamped to the replay like the other regions, and a
 * period never shorter than MIN_EDIT_MS.
 */
export function moveHighlight(
  edits: ReplayEdits,
  id: string,
  edge: 'at' | 'from' | 'to' | 'move',
  time: number,
  duration: number,
): ReplayEdits {
  const highlight = edits.highlights?.find((item) => item.id === id);
  if (!highlight) return edits;
  if (highlight.kind === 'point') return updateHighlight(edits, id, { kind: 'point', at: time }, duration);
  if (edge === 'from') return updateHighlight(edits, id, { kind: 'period', from: clamp(time, 0, highlight.to - MIN_EDIT_MS) }, duration);
  if (edge !== 'move') return updateHighlight(edits, id, { kind: 'period', to: time }, duration);
  const length = highlight.to - highlight.from;
  const from = clamp(time, 0, Math.max(0, duration - length));
  return updateHighlight(edits, id, { kind: 'period', from, to: from + length }, duration);
}

export function removeHighlight(edits: ReplayEdits, id: string): ReplayEdits {
  const highlights = (edits.highlights ?? []).filter((highlight) => highlight.id !== id);
  const { highlights: _old, ...rest } = edits;
  return highlights.length ? { ...rest, highlights } : rest;
}
