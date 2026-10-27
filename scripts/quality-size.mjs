// Size Limit's file plugin measures the existing Vite+/esbuild output; no second bundler or browser.
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bundleInventory } from './bundle-inventory.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: '.' },
    output: { type: 'string' },
    'report-directory': { type: 'string', default: '.review-artifacts/quality' },
    baseline: { type: 'string' },
    budgets: { type: 'string', default: 'budgets/bundle.json' },
    measure: { type: 'boolean', default: false },
    ratchet: { type: 'boolean', default: false },
  },
});
if (values.measure && values.ratchet) throw new Error('Choose measure or ratchet');
const directory = resolve(values['report-directory']);
await mkdir(directory, { recursive: true });
const inventory = await bundleInventory(resolve(values.root));
const budgetPath = resolve(values.budgets);
const budgets = JSON.parse(await readFile(budgetPath, 'utf8'));
if (budgets.headroomPercent !== 3) throw new Error('Bundle ratchet headroom must stay at 3%');
for (const [name, limits] of Object.entries(budgets.files)) {
  if (['raw', 'gzip', 'brotli'].some((metric) => !Number.isInteger(limits[metric]) || limits[metric] < 0)) {
    throw new Error(`Invalid bundle ceilings: ${name}`);
  }
}
const checks = [];
const unknown = [];
for (const [name, files] of Object.entries(inventory)) {
  if (!budgets.files[name]) unknown.push(name);
  for (const compression of ['raw', 'gzip', 'brotli']) {
    const limit = budgets.files[name]?.[compression];
    checks.push({
      name: `${name} (${compression})`,
      path: files,
      gzip: compression === 'gzip',
      brotli: compression === 'brotli',
      ...(!values.measure && !values.ratchet && limit !== undefined ? { limit: `${limit} B` } : {}),
    });
  }
}
const config = resolve(directory, 'size-limit.generated.json');
await writeFile(config, JSON.stringify(checks, null, 2) + '\n');
const result = spawnSync('pnpm', ['exec', 'size-limit', '--config', config, '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.signal || result.status === null || result.status > 1) throw new Error(`Size Limit failed: ${result.signal ?? result.status}`);
const measured = JSON.parse(result.stdout);
if (!Array.isArray(measured) || measured.length !== checks.length || measured.some((check) => !Number.isFinite(check.size))) {
  throw new Error('Incomplete Size Limit report');
}
const files = {};
for (let index = 0; index < checks.length; index++) {
  const match = checks[index].name.match(/^(.*) \((raw|gzip|brotli)\)$/);
  (files[match[1]] ??= {})[match[2]] = measured[index].size;
}
const violations = [];
for (const [name, sizes] of Object.entries(files)) {
  for (const [metric, size] of Object.entries(sizes)) {
    if (size > (budgets.files[name]?.[metric] ?? Infinity))
      violations.push(`${name} ${metric}: ${size} > ${budgets.files[name][metric]} bytes`);
  }
}
await writeFile(
  values.output ? resolve(values.output) : resolve(directory, 'bundle-sizes.json'),
  JSON.stringify({ files, violations, unknown }, null, 2) + '\n',
);
if (values.ratchet) {
  // Optimizations only lower existing ceilings. New/split files receive reviewed ceilings.
  for (const [name, sizes] of Object.entries(files)) {
    const previous = budgets.files[name];
    budgets.files[name] = Object.fromEntries(
      Object.entries(sizes).map(([metric, size]) => [
        metric,
        Math.min(previous?.[metric] ?? Infinity, Math.ceil(size * (1 + budgets.headroomPercent / 100))),
      ]),
    );
  }
  for (const name of Object.keys(budgets.files)) if (!files[name]) delete budgets.files[name];
  await writeFile(budgetPath, JSON.stringify(budgets, null, 2) + '\n');
}
const baseline = values.baseline ? JSON.parse(await readFile(resolve(values.baseline), 'utf8')).files : {};
const delta = (size, old) => (old === undefined ? 'new' : `${size - old >= 0 ? '+' : ''}${size - old}`);
const rows = [
  '## Bundle sizes (bytes)',
  '',
  values.baseline
    ? 'Deltas compare fresh builds of this head and origin/main using the same runner/toolchain.'
    : 'No main comparison supplied; measure main with --measure --root first.',
  '',
  '| Artifact | Raw (Δ main) | Gzip (Δ main) | Brotli (Δ main) |',
  '| --- | ---: | ---: | ---: |',
];
for (const name of [...new Set([...Object.keys(files), ...Object.keys(baseline)])].sort()) {
  const sizes = files[name];
  rows.push(
    sizes
      ? `| ${name} | ${['raw', 'gzip', 'brotli'].map((metric) => `${sizes[metric]} (${delta(sizes[metric], baseline[name]?.[metric])})`).join(' | ')} |`
      : `| ${name} | removed | removed | removed |`,
  );
}
rows.push(
  '',
  `${violations.length} over-budget measurements; ${unknown.length} unbudgeted artifacts.`,
  ...violations,
  ...unknown.map((name) => `Unbudgeted: ${name}`),
  '',
);
const summary = rows.join('\n');
console.log(summary);
await writeFile(resolve(directory, 'bundle-sizes.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (!values.measure && !values.ratchet && (violations.length || unknown.length)) process.exitCode = 1;
