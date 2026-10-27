import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const statuses = new Set(['Killed', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Timeout', 'Ignored', 'Pending']);

function recordKills(mutant, ids, killedBy) {
  if (!statuses.has(mutant.status)) throw new Error(`Unsupported mutant status: ${mutant.status}`);
  if (mutant.status === 'Pending') throw new Error('Mutation report is incomplete.');
  if (!Array.isArray(mutant.killedBy ?? [])) throw new Error('Invalid kill attribution.');
  if (mutant.status === 'Killed' && !mutant.killedBy?.length) throw new Error('Killed mutants lack test attribution.');
  for (const id of mutant.killedBy ?? []) {
    if (!ids.has(id)) throw new Error(`Unknown killing test id: ${id}`);
    killedBy.add(id);
  }
}

export function summarizeMutations(report) {
  if (!report.files || !report.testFiles) throw new Error('Mutation report must include files and testFiles.');
  const tests = Object.entries(report.testFiles).flatMap(([file, entry]) =>
    entry.tests.map((test) => {
      if (typeof test.id !== 'string' || typeof test.name !== 'string') throw new Error(`Invalid test inventory: ${file}`);
      return { file, ...test };
    }),
  );
  if (!tests.length) throw new Error('No tests were inventoried; run Stryker with the Vitest runner first.');
  const ids = new Set(tests.map((test) => test.id));
  if (ids.size !== tests.length) throw new Error('Duplicate test ids prevent reliable kill attribution.');
  const killedBy = new Set();
  const modules = Object.entries(report.files).map(([file, entry]) => {
    const counts = {};
    for (const mutant of entry.mutants) {
      recordKills(mutant, ids, killedBy);
      counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
    }
    const detected = (counts.Killed ?? 0) + (counts.Timeout ?? 0);
    const total = detected + (counts.Survived ?? 0) + (counts.NoCoverage ?? 0);
    return { file, counts, score: total ? (detected / total) * 100 : null };
  });
  if (!modules.some((entry) => Object.keys(entry.counts).length)) throw new Error('No mutants were measured.');
  return {
    modules,
    tests: tests.length,
    candidates: tests.filter((test) => !killedBy.has(test.id)),
    inventory: tests,
    killers: tests.filter((test) => killedBy.has(test.id)),
  };
}

const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const testKey = (test) => JSON.stringify([test.file, test.name, test.location]);

function readSummary(path) {
  const input = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(input.reports)) return summarizeMutations(input);
  if (!input.expected || input.reports.length !== input.expected) throw new Error('Mutation scope is incomplete.');
  const reports = input.reports.map((file) => summarizeMutations(JSON.parse(readFileSync(file, 'utf8'))));
  const inventory = new Map(reports.flatMap((report) => report.inventory).map((test) => [testKey(test), test]));
  const killed = new Set(reports.flatMap((report) => report.killers).map(testKey));
  return {
    modules: reports.flatMap((report) => report.modules),
    tests: inventory.size,
    candidates: [...inventory.values()].filter((test) => !killed.has(testKey(test))),
  };
}

function writeReport(path) {
  const summary = readSummary(path);
  const lines = [
    '# Mutation report (report-only)',
    '',
    '| Module | Score | Killed | Survived | No coverage | Timeout |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...summary.modules.map(
      ({ file, score, counts }) =>
        `| ${cell(file)} | ${score === null ? 'n/a' : `${score.toFixed(2)}%`} | ${counts.Killed ?? 0} | ${counts.Survived ?? 0} | ${counts.NoCoverage ?? 0} | ${counts.Timeout ?? 0} |`,
    ),
    '',
    `## Tests with zero attributed kills (${summary.candidates.length}/${summary.tests})`,
    '',
    'Candidates for review only. Stryker bails on the first killing test; scope, redundant coverage and timeout detection can all leave useful tests here. Never delete from this list alone.',
    '',
    '| Test file | Test |',
    '| --- | --- |',
    ...summary.candidates.map((test) => `| ${cell(test.file)} | ${cell(test.name)} |`),
  ];
  const output = '.review-artifacts/mutation/summary.md';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeReport(process.argv[2] ?? '.review-artifacts/mutation/manifest.json');
}
