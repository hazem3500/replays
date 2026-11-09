import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const artifact = resolve(root, 'dist/capture-package');
const pkg = JSON.parse(await readFile(resolve(artifact, 'package.json'), 'utf8'));
const capabilities = JSON.parse(await readFile(resolve(artifact, 'capabilities.json'), 'utf8'));
const evidence = JSON.parse(await readFile(resolve(artifact, 'build-evidence.json'), 'utf8'));
assert.equal(pkg.private, true);
assert.equal(pkg.exports, undefined);
assert.deepEqual(pkg.dependencies, evidence.dependencies);
assert.ok((await readFile(resolve(artifact, 'recorder.iife.js'))).length > 0);
assert.ok(!Object.keys(pkg.dependencies).some((name) => /react|tanstack|opentelemetry|agent-native/.test(name)));

const sandbox = await mkdtemp(resolve(tmpdir(), 'replays-capture-pack-'));
const run = (program, args, cwd) => {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', env: { ...process.env, REPLAYS_CONFIG: '', HOME: sandbox } });
  if (result.error) throw result.error;
  return result;
};
try {
  const packed = run('npm', ['pack', artifact, '--json', '--ignore-scripts'], sandbox);
  assert.equal(packed.status, 0, packed.stderr);
  const [pack] = JSON.parse(packed.stdout);
  const files = pack.files.map((file) => file.path).sort();
  assert.deepEqual(files, ['LICENSE', 'capabilities.json', 'cli.mjs', 'package.json', 'recorder.iife.js']);
  await writeFile(resolve(sandbox, 'package.json'), '{"private":true,"type":"module"}\n');
  const installed = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(sandbox, pack.filename)], sandbox);
  assert.equal(installed.status, 0, installed.stderr);
  const cli = resolve(sandbox, 'node_modules', pkg.name, 'cli.mjs');
  const help = run(process.execPath, [cli, '--help'], sandbox);
  assert.equal(help.status, 0, help.stderr);
  for (const command of capabilities.commands) assert.match(help.stdout, new RegExp(`  ${command}\\s`));
  for (const command of capabilities.omittedCommands) {
    assert.doesNotMatch(help.stdout, new RegExp(`  ${command}\\s`));
    const rejected = run(process.execPath, [cli, command], sandbox);
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /requires the full/);
  }
  const imported = run(process.execPath, [cli, 'import'], sandbox);
  assert.equal(imported.status, 1);
  assert.match(imported.stderr, /--rrweb/);
  const capture = run(process.execPath, [cli, 'capture', '--help'], sandbox);
  assert.equal(capture.status, 0, capture.stderr);
  const upload = run(process.execPath, [cli, 'upload', '--help'], sandbox);
  assert.equal(upload.status, 0, upload.stderr);
  assert.match(upload.stdout, /usage: replays upload/);
  const manifest = JSON.parse(await readFile(resolve(sandbox, 'node_modules', pkg.name, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies)) {
    assert.ok((await readdir(resolve(sandbox, 'node_modules', dependency))).length > 0);
  }
  console.log(JSON.stringify({ files, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, dependencies: pkg.dependencies }, null, 2));
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
