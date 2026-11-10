import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const packageName = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);

test('the CLI bundle needs only playwright-core and loads no server or viewer module', async () => {
  const out = await mkdtemp(join(tmpdir(), 'replays-cli-'));
  try {
    const metafile = join(out, 'metafile.json');
    execFileSync(process.execPath, [join(root, 'scripts/build-cli.mjs')], {
      cwd: root,
      env: { ...process.env, REPLAYS_CLI_OUT: join(out, 'cli'), REPLAYS_CLI_METAFILE: metafile },
      stdio: 'pipe',
    });
    const builds = JSON.parse(await readFile(metafile, 'utf8'));
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const name of ['cli', 'edit']) {
      const externals = new Set();
      for (const output of Object.values(builds[name].outputs))
        for (const item of output.imports) if (item.external && !builtins.has(item.path) && !item.path.startsWith('./')) externals.add(packageName(item.path));
      assert.deepEqual(
        [...externals].filter((dependency) => !Object.hasOwn(manifest.dependencies, dependency) && !['esbuild', 'bufferutil', 'utf-8-validate'].includes(dependency)),
        [],
        `${name}: packages outside dependencies`,
      );
      const serverOnly = Object.keys(builds[name].inputs).filter((input) =>
        /^src\/(client|mcp|first-party)\/|^src\/server\/(main|start|app|migrate|migrate-cli|static|runtime|tracing-sdk|http\/node)\.ts$|node_modules\/(@opentelemetry|srvx|h3|effect|@agent-native|react|rrweb)\//.test(input),
      );
      assert.deepEqual(serverOnly, [], `${name}: server-only inputs`);
    }
    for (const dependency of Object.keys(manifest.peerDependencies))
      assert.equal(Object.hasOwn(manifest.dependencies, dependency), false, `${dependency} is a viewer dependency`);
    for (const [name, range] of Object.entries(manifest.peerDependencies))
      assert.ok(manifest.devDependencies[name], `${name} must also be a devDependency so the repository installs it (${range})`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
