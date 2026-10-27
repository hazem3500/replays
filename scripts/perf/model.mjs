export const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** V8 reports nested ranges. Counts a source code unit only if its innermost range was executed. */
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

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

const finite = (value) => Number.isFinite(value);

function sameHardware(baseline, current) {
  return baseline?.hardware?.cpu === current.hardware?.cpu && baseline?.hardware?.cpus === current.hardware?.cpus;
}

function isComparable(baseline, current) {
  return (
    baseline?.revision === current.revision &&
    baseline?.seedRows === current.seedRows &&
    sameHardware(baseline, current) &&
    !baseline?.experiment?.ssr &&
    JSON.stringify(baseline?.profiles) === JSON.stringify(current.profiles)
  );
}

function phoneRows(check, current, gate) {
  const phone = current.pages.phone ?? {};
  check('phone index LCP ms', phone['index-list']?.median?.lcpMs, gate.phone.indexLcpMs);
  check('phone first replay title ms', phone['index-list']?.median?.firstReplayTitleMs, gate.phone.firstReplayTitleMs);
  check('phone viewer skeleton FCP ms', phone.viewer?.median?.fcpMs, gate.phone.viewerSkeletonFcpMs);
}

function profileRows(check, { current, baseline, comparable, gate, profile }) {
  const content = current.pages[profile].viewer?.median?.contentReadyMs;
  const spa = baseline?.pages[profile]?.viewer?.median?.contentReadyMs;
  const regression = comparable && finite(content) && finite(spa) ? content - spa : null;
  check(`${profile} viewer content regression ms`, regression, gate.maxViewerContentRegressionMs);
  for (const [name, page] of Object.entries(current.pages[profile])) {
    if (!page.median) continue;
    check(`${profile}/${name} hydration errors`, page.median.hydrationErrors, gate.hydrationErrors);
    if (name.startsWith('index')) {
      check(`${profile}/${name} hydration list refetches`, page.median.hydrationRefetches, gate.hydrationRefetches);
    }
  }
}

function serverRows(check, current, gate) {
  const html = current.server.indexHtml;
  check('index server TTFB p50 ms', html?.ttfbP50Ms, gate.server.ttfbP50Ms);
  check('index server TTFB p90 ms', html?.ttfbP90Ms, gate.server.ttfbP90Ms);
  check('index HTML br body bytes', html?.byEncoding?.br?.wireBytes, gate.server.htmlBrBytes);
}

export function assessSsr(current, baseline, gate) {
  const rows = [];
  const check = (name, value, limit) => rows.push({ name, value, limit, pass: finite(value) && value <= limit });
  const comparable = isComparable(baseline, current);
  rows.push({ name: 'matching SPA baseline', value: comparable ? 0 : null, limit: 0, pass: comparable });
  phoneRows(check, current, gate);
  for (const profile of Object.keys(current.pages)) profileRows(check, { current, baseline, comparable, gate, profile });
  serverRows(check, current, gate);
  rows.push({
    name: 'seed contains 100 summaries',
    value: current.seedRows,
    limit: gate.indexRows,
    pass: current.seedRows >= gate.indexRows,
  });
  return rows;
}
