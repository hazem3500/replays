import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';
import { increases } from './lib/lint-report.mjs';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd(), { noImplicitOverride: true });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
const counts = {};
const other = [];
for (const diagnostic of diagnostics) {
  if (diagnostic.code !== 4114 || !diagnostic.file) {
    other.push(diagnostic);
    continue;
  }
  const file = relative(process.cwd(), diagnostic.file.fileName).replaceAll('\\', '/');
  counts[file] = (counts[file] ?? 0) + 1;
}
const baseline = JSON.parse(readFileSync('budgets/override-baseline.json', 'utf8')).counts;
const failures = increases(counts, baseline);
for (const failure of failures) console.error(`Override debt increased: ${failure}`);
for (const [file, cap] of Object.entries(baseline)) {
  if ((counts[file] ?? 0) < cap) console.log(`Lower the override baseline: ${file}: ${cap} → ${counts[file] ?? 0}`);
}
if (other.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(other, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  );
}
console.log(JSON.stringify({ code: 'TS4114', counts }, null, 2));
if (failures.length || other.length) process.exitCode = 1;
