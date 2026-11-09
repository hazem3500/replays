import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { commentCounts, commentRiseLimit, countsFor, increases, runLint } from './lib/lint-report.mjs';

const commentTolerance = (key) => (key.endsWith('comment-policy)') ? commentRiseLimit : 0);
const commentLimit = () => commentRiseLimit;
const update = process.argv.includes('--write-baseline');
if (!existsSync('dist/types/index.d.ts'))
  throw new Error('Build package declarations with pnpm build:cli on Boat before the type-aware audit.');
const reports = {
  syntax: runLint('.oxlintrc.next.json'),
  types: runLint('.oxlintrc.types.next.json', { types: true }),
  unusedDisables: runLint('.oxlintrc.next.json', { unused: true }),
};
const counts = Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, countsFor(report)]));
const comments = commentCounts(reports.syntax);
mkdirSync('.review-artifacts/code-quality', { recursive: true });
for (const [name, report] of Object.entries(reports)) {
  writeFileSync(`.review-artifacts/code-quality/lint-${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
}
const budgetPath = 'budgets/lint-baseline.json';
const commentPath = 'budgets/comment-baseline.json';
if (update) {
  writeFileSync(budgetPath, `${JSON.stringify({ version: 1, counts }, null, 2)}\n`);
  writeFileSync(commentPath, `${JSON.stringify({ version: 1, counts: comments }, null, 2)}\n`);
  console.log('Wrote measured baselines; review every increase before committing.');
} else {
  const baseline = JSON.parse(readFileSync(budgetPath, 'utf8'));
  const commentBaseline = JSON.parse(readFileSync(commentPath, 'utf8'));
  // why: comment counts are for awareness; only a rise of more than commentRiseLimit in one file or rule blocks.
  const failures = Object.entries(counts).flatMap(([name, values]) =>
    increases(values, baseline.counts[name] ?? {}, commentTolerance).map((row) => `${name}/${row}`),
  );
  failures.push(...increases(comments, commentBaseline.counts, commentLimit).map((row) => `comments/${row}`));
  for (const row of failures) console.error(`Lint baseline increased: ${row}`);
  if (failures.length) process.exitCode = 1;
  const decreased = Object.entries(baseline.counts).flatMap(([name, values]) =>
    Object.entries(values)
      .filter(([key, value]) => (counts[name]?.[key] ?? 0) < value)
      .map(([key]) => `${name}/${key}`),
  );
  if (decreased.length) console.log(`Lower the baseline: ${decreased.join(', ')}`);
}
console.log(JSON.stringify({ counts, commentFiles: Object.keys(comments).length }, null, 2));
