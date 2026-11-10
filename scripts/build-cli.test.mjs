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
const optional = new Set(['esbuild', 'bufferutil', 'utf-8-validate']);
const serverOnly =
  /^src\/(client|mcp|first-party)\/|^src\/server\/(main|start|app|migrate|migrate-cli|static|runtime|tracing-sdk|http\/node)\.ts$|node_modules\/(@opentelemetry|srvx|h3|effect|@agent-native|react|rrweb)\//;

const externalPackages = (build) =>
  Object.values(build.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external && !builtins.has(item.path) && !item.path.startsWith('./'))
    .map((item) => packageName(item.path));

async function buildCli() {
  const out = await mkdtemp(join(tmpdir(), 'replays-cli-'));
  try {
    const metafile = join(out, 'metafile.json');
    execFileSync(process.execPath, [join(root, 'scripts/build-cli.mjs')], {
      cwd: root,
      env: { ...process.env, REPLAYS_CLI_OUT: join(out, 'cli'), REPLAYS_CLI_METAFILE: metafile },
      stdio: 'pipe',
    });
    return JSON.parse(await readFile(metafile, 'utf8'));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

test('the CLI bundles need only playwright-core and load no server or viewer module', async () => {
  const builds = await buildCli();
  for (const name of ['cli', 'edit']) {
    const undeclared = externalPackages(builds[name]).filter(
      (dependency) => !Object.hasOwn(manifest.dependencies, dependency) && !optional.has(dependency),
    );
    assert.deepEqual(undeclared, [], `${name}: packages outside dependencies`);
    assert.deepEqual(
      Object.keys(builds[name].inputs).filter((input) => serverOnly.test(input)),
      [],
      `${name}: server-only inputs`,
    );
  }
});

test('the viewer dependencies are optional peers that the repository also installs', () => {
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.equal(Object.hasOwn(manifest.dependencies, name), false, `${name} is a viewer dependency`);
    assert.ok(manifest.devDependencies[name], `${name} must also be a devDependency so the repository installs it (${range})`);
    assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, `${name} must be an optional peer`);
  }
});
