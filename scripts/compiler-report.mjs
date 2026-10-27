import { transformSync } from '@babel/core';
import compiler from 'babel-plugin-react-compiler';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function filesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return /\.[jt]sx?$/.test(path) && !path.endsWith('.d.ts') ? [path] : [];
  });
}

function compileFile(path) {
  const events = [];
  transformSync(readFileSync(path, 'utf8'), {
    filename: path,
    babelrc: false,
    configFile: false,
    code: false,
    ast: false,
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    plugins: [
      [
        compiler,
        {
          target: '19',
          logger: {
            logEvent(_filename, event) {
              if (event.kind === 'Timing') return;
              events.push({
                kind: event.kind,
                reason: event.detail?.reason,
                description: event.detail?.description,
                line: event.detail?.loc?.start?.line ?? event.fnLoc?.start?.line,
              });
            },
          },
        },
      ],
    ],
  });
  return { file: path, events };
}

const files = ['src/client', 'src/recorder', 'stories'].flatMap(filesIn).sort().map(compileFile);
if (!files.length) throw new Error('No React source files found; run from the repository root.');
const counts = {};
for (const file of files) for (const event of file.events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
const bailouts = files.filter((file) => file.events.some((event) => ['CompileError', 'CompileSkip', 'PipelineError'].includes(event.kind)));
const directory = '.review-artifacts/code-quality';
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/compiler-events.json`, `${JSON.stringify({ counts, files }, null, 2)}\n`);
const lines = [
  '# React Compiler bailout report',
  '',
  `Analyzed ${files.length} files with the installed compiler, target React 19.`,
  '',
  'This isolated logger pass measures compiler decisions; it does not prove runtime parity between builds.',
  '',
  `Events: ${JSON.stringify(counts)}`,
  '',
  '| File | Events |',
  '| --- | --- |',
];
for (const file of bailouts) {
  const reasons = file.events
    .filter((event) => event.kind !== 'CompileSuccess')
    .map((event) =>
      `${event.kind}:${event.line ?? '?'} ${event.reason ?? event.description ?? ''}`.replaceAll('|', '\\|').replaceAll('\n', ' '),
    );
  lines.push(`| ${file.file} | ${reasons.join('; ')} |`);
}
lines.push(
  '',
  'CompileError/CompileSkip events are report-only. Pipeline errors fail. See docs/compiler-health.md for the measured build-parity status.',
);
writeFileSync(`${directory}/compiler-bailouts.md`, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ files: files.length, bailoutFiles: bailouts.length, counts }, null, 2));
if (counts.PipelineError) process.exitCode = 1;
