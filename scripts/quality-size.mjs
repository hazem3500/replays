// Size Limit's file plugin measures the existing Vite+/esbuild output; no second bundler or browser.
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bundleInventory } from './bundle-inventory.mjs';
import { authorizeBudget, budgetDiff, ratchetBudget, significantGrowth, validateBudget } from './bundle-budgets.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: '.' },
    output: { type: 'string' },
    'report-directory': { type: 'string', default: '.review-artifacts/quality' },
    baseline: { type: 'string' },
    'baseline-budgets': { type: 'string' },
    'pr-url': { type: 'string' },
    'check-ratchet': { type: 'boolean', default: false },
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
const original = JSON.parse(await readFile(budgetPath, 'utf8'));
validateBudget(original);
let mainBudgets = original;
if (!values.measure) {
  if (values['baseline-budgets']) mainBudgets = JSON.parse(await readFile(resolve(values['baseline-budgets']), 'utf8'));
  else {
    const result = spawnSync('git', ['show', 'origin/main:budgets/bundle.json'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Fetch origin/main or pass --baseline-budgets before checking bundle caps');
    mainBudgets = JSON.parse(result.stdout);
  }
}
const authorization = values.measure
  ? { approved: original, failures: [], allowances: [] }
  : authorizeBudget(original, mainBudgets, values['pr-url'] ?? process.env.BUNDLE_PR_URL);
const budgets = authorization.approved;
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
      ...(!values.measure && limit !== undefined ? { limit: `${limit} B` } : {}),
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
const mainFiles = values.baseline ? JSON.parse(await readFile(resolve(values.baseline), 'utf8')).files : undefined;
const significant = significantGrowth(files, mainFiles, budgets);
const violations = [];
for (const [name, sizes] of Object.entries(files)) {
  for (const [metric, size] of Object.entries(sizes)) {
    if (size > (budgets.files[name]?.[metric] ?? Infinity))
      violations.push(`${name} ${metric}: ${size} > ${budgets.files[name][metric]} bytes`);
  }
}
await writeFile(
  values.output ? resolve(values.output) : resolve(directory, 'bundle-sizes.json'),
  JSON.stringify({ files, violations, unknown, allowanceErrors: authorization.failures, significant }, null, 2) + '\n',
);
const baseline = values.baseline ? JSON.parse(await readFile(resolve(values.baseline), 'utf8')).files : {};
const nextBudgets = values.measure ? budgets : ratchetBudget(budgets, files, values.baseline ? baseline : undefined);
const budgetChanged = JSON.stringify(original) !== JSON.stringify(nextBudgets);
if (!values.measure && !values['check-ratchet'] && !authorization.failures.length) {
  await writeFile(budgetPath, JSON.stringify(nextBudgets, null, 2) + '\n');
}
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
  `${violations.length} measurements above their cap and ${unknown.length} unbudgeted artifacts (reported only); ${significant.length} significant jumps.`,
  ...violations,
  ...unknown.map((name) => `Unbudgeted: ${name}`),
  '',
);
rows.push(
  ...authorization.failures,
  ...significant.map((failure) => `Significant jump: ${failure}`),
  ...(budgetChanged ? ['Caps could be lowered; run pnpm quality:size:ratchet when convenient (optional).'] : []),
);
const summary = rows.join('\n') + budgetDiff(mainBudgets, nextBudgets, authorization.allowances);
console.log(summary);
await writeFile(resolve(directory, 'bundle-sizes.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (!values.measure && significant.length) process.exitCode = 1;
