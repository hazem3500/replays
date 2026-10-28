function gap(ordered: ReadonlyArray<{ at: number }>, end: number) {
  return (ordered[end]?.at ?? Infinity) - (ordered[end - 1]?.at ?? 0);
}

/** Horizontal hit-target offsets for timeline annotations, in CSS pixels. */
export function highlightTargetOffsets(positions: readonly number[], width: number, targetSize: number): number[] {
  const offsets = positions.map(() => 0);
  if (!positions.length || width <= 0 || targetSize <= 0) return offsets;
  const maxCenter = Math.max(targetSize / 2, width - targetSize / 2);
  const ordered = positions
    .map((at, index) => ({ at: Math.min(width, Math.max(0, at)), index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);

  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && gap(ordered, end) < targetSize) end++;
    const count = end - start;
    if (count === 1) {
      const item = ordered[start];
      if (item) offsets[item.index] = Math.min(maxCenter, Math.max(targetSize / 2, item.at)) - item.at;
    } else {
      const sourceCenter = ordered.slice(start, end).reduce((total, item) => total + item.at, 0) / count;
      const targetCenter = Math.min(width - (count * targetSize) / 2, Math.max((count * targetSize) / 2, sourceCenter));
      for (let index = start; index < end; index++) {
        const item = ordered[index];
        if (item) offsets[item.index] = targetCenter + (index - start - (count - 1) / 2) * targetSize - item.at;
      }
    }
    start = end;
  }
  return offsets;
}

/** Which end of a period a marker sits on; point highlights have a single marker and no edge. */
export function highlightEdge(kind: 'point' | 'period', index: number) {
  if (kind !== 'period') return;
  return index === 0 ? 'from' : 'to';
}
