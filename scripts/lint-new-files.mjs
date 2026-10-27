import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runLint } from './lib/lint-report.mjs';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

const staged = process.argv.includes('--staged');
const baseIndex = process.argv.indexOf('--base');
const base = baseIndex < 0 ? process.env.LINT_BASE_REF : process.argv[baseIndex + 1];
if (!staged && !base) throw new Error('Pass --base <base SHA/ref> or --staged; refusing to skip the new-file gate.');
const diff = staged ? ['--cached'] : [git(['merge-base', base, 'HEAD']).trim()];
const files = git(['diff', ...diff, '--name-only', '-z', '--diff-filter=A', '--'])
  .split('\0')
  .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
if (staged) {
  for (const file of files) {
    if (git(['show', `:${file}`]) !== readFileSync(file, 'utf8')) throw new Error(`Restage ${file} before checking new files.`);
  }
}
if (files.length) {
  const syntax = runLint('.oxlintrc.next.json', { files, strict: true, unused: true });
  const typedFiles = files.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file));
  const types = typedFiles.length
    ? runLint('.oxlintrc.types.next.json', { files: typedFiles, types: true, strict: true })
    : { diagnostics: [] };
  const diagnostics = [...syntax.diagnostics, ...types.diagnostics];
  for (const diagnostic of diagnostics) console.error(`${diagnostic.filename}: ${diagnostic.code}: ${diagnostic.message}`);
  if (diagnostics.length) process.exitCode = 1;
}
console.log(`Final lint rules checked ${files.length} added files.`);
