import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../../performance-budget.config.mjs';

const [currentPath = '.review-artifacts/perf/current/results.json', basePath, outputPath = '.review-artifacts/perf/report.md'] =
  process.argv.slice(2);
const current = JSON.parse(await readFile(resolve(currentPath), 'utf8'));
const baseline = basePath ? JSON.parse(await readFile(resolve(basePath), 'utf8')) : null;
const fmt = (value) => (typeof value === 'number' ? Number(value.toFixed(value < 1 ? 3 : 1)).toLocaleString('en-US') : 'n/a');
const delta = (value, base) =>
  typeof value === 'number' && typeof base === 'number' ? `${value - base >= 0 ? '+' : ''}${fmt(value - base)}` : 'n/a';
const lines = [
  '<!-- replays-runtime-performance -->',
  '## Runtime performance (report-only)',
  '',
  `Head: ${current.revision}; main: ${baseline?.revision ?? 'unavailable'}. ${current.samples} samples per scenario, median.`,
  '',
  `Hardware: ${current.hardware.cpus} CPUs (${current.hardware.cpu}), ${fmt(current.hardware.memoryBytes / 1024 ** 3)} GiB RAM; ${current.hardware.platform}/${current.hardware.arch}; Node ${current.hardware.node}; Chromium ${current.hardware.chromium ?? 'unavailable'}.`,
  '',
  'Cold browser cache, warm server compression cache. Phone: 4× CPU, 150 ms latency, 1.6 Mbps down / 750 kbps up. Desktop: 1× CPU, unthrottled network. Grid uses 1280×800 in both profiles because the app forces list layout on narrow screens.',
  '',
  'Each cell is `median (delta vs main) / budget`. INP is a scripted lab observation; n/a means no Event Timing observation ≥16 ms, not zero. Heap is CDP JS heap after playback (no forced GC), not total process memory.',
  '',
  '| Profile / page | LCP ms | CLS | Lab INP ms | TTFB ms | TBT ms | Long tasks | First frame ms | Script ms | JS used chars¹ | Requests | Transfer bytes | Heap bytes |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
const keys = [
  'lcpMs',
  'cls',
  'inpMs',
  'ttfbMs',
  'tbtMs',
  'longTasks',
  'firstFrameMs',
  'scriptMs',
  'jsUsedBytes',
  'requests',
  'transferBytes',
  'heapBytes',
];
for (const [profile, pages] of Object.entries(current.pages)) {
  for (const [name, page] of Object.entries(pages)) {
    if (page.unavailable) {
      lines.push(`| ${profile} / ${name} | ${page.unavailable} |`);
      continue;
    }
    const metrics = page.median;
    const base = baseline?.pages[profile]?.[name]?.median ?? {};
    const cells = keys.map(
      (key) =>
        `${fmt(metrics[key])} (${delta(metrics[key], base[key])}) / ${fmt(config.budgets[profile][key])}${typeof metrics[key] === 'number' && metrics[key] > config.budgets[profile][key] ? ' ⚠' : ''}`,
    );
    lines.push(`| ${profile} / ${name} | ${cells.join(' | ')} |`);
  }
}
lines.push(
  '',
  '¹ V8 executed source ranges in UTF-16 code units, counted once per script, rather than downloaded/minified bundle size; see the separate bundle-size budget.',
  '',
  '### Server (loopback; unthrottled, fresh TCP connection)',
  '',
  '| Endpoint / encoding | TTFB ms (Δ) / budget | Full response ms (Δ) / budget | Body bytes (Δ) / budget | Compression | Cache-Control | ETag / conditional status |',
  '| --- | ---: | ---: | ---: | --- | --- | --- |',
);
for (const [name, result] of Object.entries(current.server)) {
  for (const [encoding, metrics] of Object.entries(result.byEncoding)) {
    const base = baseline?.server[name]?.byEncoding[encoding] ?? {};
    const rows = result.samples.filter((row) => row.encoding === encoding);
    const row = rows[0];
    const values = ['ttfbMs', 'responseMs', 'wireBytes'].map(
      (key) => `${fmt(metrics[key])} (${delta(metrics[key], base[key])}) / ${fmt(config.server[name][key])}`,
    );
    lines.push(
      `| ${name} / ${encoding} | ${values.join(' | ')} | ${row.headers['content-encoding'] ?? 'identity'} | ${row.headers['cache-control'] ?? 'absent'} | ${row.headers.etag ? 'present' : 'absent'} / ${[...new Set(rows.map((item) => item.conditional?.status ?? 'n/a'))].join(',')} |`,
    );
  }
}
lines.push(
  '',
  `Seed: ${current.seed ?? 'unavailable'}. Raw samples, response headers and Playwright traces are in the runtime-performance artifact.`,
  '',
  'LCP is observed before scripted input. TBT is long-task blocking time from FCP through route readiness plus 1.5 s. Long-task count includes playback and interactions. First frame is navigation-to-two-animation-frames after the recorded DOM exists in rrweb; it approximates presentation, not a compositor timestamp.',
);
if (current.errors.length)
  lines.push(
    '',
    '### Harness errors (not budget failures)',
    '',
    ...current.errors.map((error) => `- ${error.replaceAll('\n', ' ').replaceAll('|', '\\|')}`),
  );
if (baseline?.errors.length) lines.push('', 'Baseline harness errors: deltas may be unavailable. See baseline artifact.');
const markdown = `${lines.join('\n')}\n`;
await writeFile(resolve(outputPath), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
