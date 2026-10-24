// Proves the package works as installed, not just as a checkout: packs it, installs the tarball into an empty project
// outside the repository, and starts a server there from replays.config.mjs through the subpath exports.
// Needs `pnpm build && pnpm build:cli` first (it checks that dist/ is complete). Network: npm fetches the dependencies.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = await mkdtemp(join(tmpdir(), 'replays-pack-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

try {
  const out = join(work, 'tarball');
  run('pnpm', ['pack', '--pack-destination', out], root);
  const [tarball] = await readdir(out);
  const app = join(work, 'app');
  await mkdir(app);
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  await writeFile(
    join(app, 'replays.config.mjs'),
    `import { defineConfig } from '@hazem3500/replays/config';
import { definePlugin } from '@hazem3500/replays/plugin';
export default defineConfig({
  plugins: [definePlugin({ name: 'packed', setup(api) { api.branding({ name: 'Packed' }); api.basePath('/packed'); } })],
});
`,
  );
  await writeFile(
    join(app, 'check.mjs'),
    `import assert from 'node:assert/strict';
import { MemoryStorage, startServer, verifyJwt } from '@hazem3500/replays/server';
import { describeObjectStorage } from '@hazem3500/replays/server/testing';
import { defineViewerPlugin, VIEWER_API_VERSION } from '@hazem3500/replays/viewer';
import { RecorderSession } from '@hazem3500/replays/capture';
assert.equal(typeof defineViewerPlugin, 'function');
assert.equal(defineViewerPlugin(() => {}).apiVersion, VIEWER_API_VERSION);
assert.equal(typeof RecorderSession, 'function');
assert.equal(typeof verifyJwt, 'function');
// The contract suite needs no test framework installed: a two-function runner is enough.
const contract = [];
describeObjectStorage('memory', () => new MemoryStorage(), { describe: (_name, body) => body(), it: (name, test) => contract.push([name, test]) });
for (const [, test] of contract) await test();
assert.ok(contract.length >= 8, 'the storage contract ran');
const server = await startServer({ port: 0, log: () => {}, env: { ...process.env, DATA_DIR: ${JSON.stringify(join(work, 'data'))}, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' } });
const config = await (await fetch(server.origin + '/packed/api/config')).json();
assert.equal(config.name, 'Packed');
assert.deepEqual(config.plugins, ['comments', 'packed']);
const html = await (await fetch(server.origin + '/packed/', { headers: { accept: 'text/html' } })).text();
assert.ok(html.includes('<title>Packed</title>'), 'the built viewer is served with the plugin branding');
assert.equal((await (await fetch(server.origin + '/packed/api/replays')).json()).length, 2, 'the bundled samples are served');
await server.close();
console.log('pack smoke ok');
`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', join(out, tarball)], app);
  console.log(run(process.execPath, ['check.mjs'], app).trim());
} finally {
  await rm(work, { recursive: true, force: true });
}
