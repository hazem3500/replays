import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';

function projectFiles() {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  if (parsed.errors.length)
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  if (!parsed.fileNames.length) throw new Error('The TypeScript project contains no files.');
  return parsed.fileNames;
}

function parseReport(result) {
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(`oxlint failed (${result.status}): ${result.stderr || result.stdout}`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid oxlint report: ${result.stderr || result.stdout}`);
  }
  if (!Array.isArray(report.diagnostics) || !Number.isInteger(report.number_of_files) || report.number_of_files < 1) {
    throw new Error(`Incomplete oxlint report: ${result.stderr || result.stdout}`);
  }
  if (result.status === 1 && report.diagnostics.length === 0) throw new Error(`oxlint failed without diagnostics: ${result.stderr}`);
  return report;
}

function normalizeDiagnostics(report) {
  for (const diagnostic of report.diagnostics) {
    if (!diagnostic.code && /^Unused (?:oxlint|eslint)-disable directive/.test(diagnostic.message))
      diagnostic.code = 'oxlint/unused-disable';
    if (!diagnostic.code) throw new Error(`Unclassified lint/parser failure: ${JSON.stringify(diagnostic)}`);
  }
  return report;
}

export function runLint(config, { files = [], types = false, strict = false, unused = false } = {}) {
  const paths = types && !files.length ? projectFiles() : files;
  const args = [resolve('node_modules/oxlint/bin/oxlint'), '--config', config, '--format', 'json', '--threads', '1'];
  if (types) args.push('--type-aware');
  if (strict) args.push('--deny-warnings');
  if (unused) args.push('--report-unused-disable-directives-severity', 'warn');
  if (paths.length) args.push('--', ...paths);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return normalizeDiagnostics(parseReport(result));
}

export function countsFor(report) {
  const counts = {};
  for (const diagnostic of report.diagnostics) counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function commentCounts(report) {
  const counts = {};
  for (const diagnostic of report.diagnostics) {
    if (!diagnostic.code.endsWith('(comment-policy)') && !diagnostic.code.endsWith('/comment-policy')) continue;
    const file = diagnostic.filename.replaceAll('\\', '/');
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export const commentRiseLimit = 10;

export function increases(current, baseline, tolerance = () => 0) {
  return Object.entries(current)
    .filter(([key, count]) => count - (baseline[key] ?? 0) > tolerance(key))
    .map(([key, count]) => `${key}: ${baseline[key] ?? 0} → ${count}`);
}
