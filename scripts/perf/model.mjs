export const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// V8 reports nested ranges. Count a source code unit only if its innermost range was executed.
export function usedBytes(functions) {
  const ranges = functions.flatMap((fn) => fn.ranges);
  const events = ranges
    .flatMap((range, id) => [
      { at: range.startOffset, id, start: true },
      { at: range.endOffset, id, start: false },
    ])
    .sort((a, b) => a.at - b.at);
  const active = new Map();
  let total = 0,
    previous = 0;
  for (const event of events) {
    let inner;
    for (const range of active.values()) {
      if (!inner || range.endOffset - range.startOffset < inner.endOffset - inner.startOffset) inner = range;
    }
    if (inner?.count > 0) total += event.at - previous;
    if (event.start) active.set(event.id, ranges[event.id]);
    else active.delete(event.id);
    previous = event.at;
  }
  return total;
}

export function summarize(samples) {
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample.metrics ?? {})));
  return Object.fromEntries([...keys].map((key) => [key, median(samples.map((sample) => sample.metrics?.[key]))]));
}

export function violations(metrics, limits) {
  return Object.entries(limits).flatMap(([key, limit]) =>
    typeof metrics[key] === 'number' && metrics[key] > limit ? [{ key, value: metrics[key], limit }] : [],
  );
}
