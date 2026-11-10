import { builtinModules } from 'node:module';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist/capture-package');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/capture/injected-recorder.ts')],
  outfile: resolve(out, 'recorder.iife.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
});
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/capture/cli.ts'],
  outfile: resolve(out, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  metafile: true,
});
const imports = [...new Set(Object.values(result.metafile.outputs).flatMap((output) => output.imports.map((item) => item.path)))].sort();
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const dependencies = {};
for (const specifier of imports) {
  if (builtins.has(specifier)) continue;
  if (specifier.startsWith('.') || specifier.startsWith('/')) throw new Error(`unexpected external file: ${specifier}`);
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const version = pkg.dependencies[name] ?? pkg.devDependencies[name];
  if (!version) throw new Error(`undeclared capture dependency: ${specifier}`);
  dependencies[name] = version;
}
const inputs = Object.keys(result.metafile.inputs).sort();
const forbidden = inputs.filter(
  (input) => /src\/(client|mcp|first-party)\//.test(input) || /src\/server\/(main|start|app|migrate-cli|static)\.ts$/.test(input),
);
if (forbidden.length) throw new Error(`capture artifact includes full-distribution entry points: ${forbidden.join(', ')}`);
await copyFile(resolve(root, 'LICENSE'), resolve(out, 'LICENSE'));
await writeFile(
  resolve(out, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      description: 'Capture-only staging artifact; not the full Replays distribution.',
      license: pkg.license,
      engines: pkg.engines,
      bin: { replays: './cli.mjs' },
      files: ['cli.mjs', 'recorder.iife.js', 'capabilities.json', 'LICENSE'],
      dependencies,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  resolve(out, 'capabilities.json'),
  `${JSON.stringify(
    {
      distribution: 'capture-only',
      commands: ['capture', 'import', 'upload', 'connect', 'login', 'status', 'logout', 'config', 'doctor'],
      omittedCommands: ['serve', 'migrate', 'build-static', 'plugin', 'mcp'],
      programmaticExports: false,
    },
    null,
    2,
  )}\n`,
);
await writeFile(resolve(out, 'build-evidence.json'), `${JSON.stringify({ inputs, imports, dependencies }, null, 2)}\n`);
console.log(`Built private capture-only staging artifact: ${out}`);
