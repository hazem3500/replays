import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { criticalModules } from '../stryker.config.mjs';
import { summarizeMutations } from './mutation-report.mjs';

const { values } = parseArgs({ options: { mutate: { type: 'string' }, testFiles: { type: 'string' } } });
const targets = values.mutate ? criticalModules.filter((entry) => entry.file === values.mutate) : criticalModules;
if (!targets.length) throw new Error(`Unknown critical mutation target: ${values.mutate}`);
if (values.testFiles && targets.length !== 1) throw new Error('--testFiles requires one --mutate target.');
const directory = '.review-artifacts/mutation';
mkdirSync(`${directory}/modules`, { recursive: true });
const manifest = { expected: targets.length, scope: targets.map((entry) => entry.file), reports: [] };
const save = () => writeFileSync(`${directory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
save();
for (const target of targets) {
  const slug = target.file.replaceAll('/', '-').replace(/\.ts$/, '');
  const output = `${directory}/modules/${slug}.json`;
  const overrides = {
    mutate: [target.file],
    testFiles: values.testFiles ? values.testFiles.split(',') : target.tests,
    incrementalFile: `${directory}/modules/${slug}-incremental.json`,
    jsonReporter: { fileName: output },
    htmlReporter: { fileName: `${directory}/modules/${slug}.html` },
  };
  const config = `${directory}/${slug}.config.mjs`;
  writeFileSync(
    config,
    `import base from ${JSON.stringify(pathToFileURL(resolve('stryker.config.mjs')).href)};\nexport default {...base,...${JSON.stringify(overrides)}};\n`,
  );
  console.log(`Measuring ${target.file} with ${overrides.testFiles.join(', ')}; static mutants remain enabled.`);
  const result = spawnSync(process.execPath, [resolve('node_modules/@stryker-mutator/core/bin/stryker.js'), 'run', config], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  summarizeMutations(JSON.parse(readFileSync(output, 'utf8')));
  manifest.reports.push(output);
  save();
}
