import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { bundleInventory, bundleKey } from './bundle-inventory.mjs';

test('bundle budgets cover lazy files, static entry closures, growth and new artifacts; ratchet only lowers', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'replays-quality-'));
  try {
    const put = async (file, content) => {
      const path = resolve(root, file);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    };
    for (const file of ['dist/lib/index.mjs', 'dist/cli/cli.mjs', 'bin/replays.mjs']) await put(file, 'export const value = 1;');
    await put('dist/lib/chunks/chunk-ABCDEFGH.mjs', 'export const a = 1;');
    await put('dist/lib/chunks/chunk-IJKLMNOP.mjs', 'export const b = 2;');
    await put('dist/lib/.metafile.json', {
      outputs: {
        [resolve(root, 'dist/lib/chunks/chunk-ABCDEFGH.mjs')]: { inputs: { [resolve(root, 'src/shared/a.ts')]: {} } },
        [resolve(root, 'dist/lib/chunks/chunk-IJKLMNOP.mjs')]: { inputs: { [resolve(root, 'src/shared/b.ts')]: {} } },
      },
    });
    await put('dist/client/assets/main-ABCDEFGH.js', 'import "./shared-ABCDEFGH.js";');
    await put('dist/client/assets/shared-ABCDEFGH.js', 'export const shared = 1;');
    await put('dist/client/assets/main-ABCDEFGH.css', 'body { color: red; }');
    await put('dist/client/assets/lazy-ABCDEFGH.js', 'export const lazy = 1;');
    await put('dist/client/.vite/manifest.json', {
      'index.html': {
        file: 'assets/main-ABCDEFGH.js',
        isEntry: true,
        css: ['assets/main-ABCDEFGH.css'],
        imports: ['shared'],
        dynamicImports: ['lazy'],
      },
      shared: { file: 'assets/shared-ABCDEFGH.js', css: ['assets/main-ABCDEFGH.css'] },
      lazy: { file: 'assets/lazy-ABCDEFGH.js', isDynamicEntry: true },
    });
    const inventory = await bundleInventory(root);
    assert.equal(inventory['initial/index.html/js'].length, 2);
    assert.equal(Object.keys(inventory).filter((name) => name.startsWith('dist/lib/chunks/')).length, 2);
    assert.equal(inventory['initial/index.html/css'].length, 1);
    assert.ok(inventory['dist/client/assets/lazy-HASH.js']);
    assert.equal(bundleKey('dist/client/assets/main-12345678.js'), bundleKey('dist/client/assets/main-ABCDEFGH.js'));
    const budgets = resolve(root, 'budgets.json');
    await put('budgets.json', { headroomPercent: 3, files: {} });
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [
          'scripts/quality-size.mjs',
          '--root',
          root,
          '--report-directory',
          resolve(root, 'reports'),
          '--budgets',
          budgets,
          '--baseline-budgets',
          resolve(root, 'main-budgets.json'),
          '--output',
          resolve(root, 'sizes.json'),
          ...args,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run('--measure').status, 0);
    const initialSizes = JSON.parse(await readFile(resolve(root, 'sizes.json'), 'utf8')).files;
    const initialBudget = {
      headroomPercent: 3,
      files: Object.fromEntries(
        Object.entries(initialSizes).map(([file, sizes]) => [
          file,
          Object.fromEntries(Object.entries(sizes).map(([metric, size]) => [metric, Math.ceil(size * 1.03)])),
        ]),
      ),
    };
    await put('budgets.json', initialBudget);
    await put('main-budgets.json', initialBudget);
    assert.equal(run().status, 0);
    const original = JSON.parse(await readFile(budgets, 'utf8'));
    await put('dist/client/assets/lazy-ABCDEFGH.js', `export const lazy = ${JSON.stringify('bigger'.repeat(100))};`);
    assert.equal(run().status, 1, 'growth must block');
    assert.equal(run('--ratchet').status, 1, 'ratchet must retain the blocking size gate');
    const after = JSON.parse(await readFile(budgets, 'utf8'));
    assert.deepEqual(
      after.files['dist/client/assets/lazy-HASH.js'],
      original.files['dist/client/assets/lazy-HASH.js'],
      'ratchet must not raise limits',
    );
    await put('dist/client/assets/lazy-ABCDEFGH.js', '');
    assert.equal(run('--ratchet').status, 0);
    const optimized = JSON.parse(await readFile(budgets, 'utf8'));
    assert.ok(optimized.files['dist/client/assets/lazy-HASH.js'].raw < original.files['dist/client/assets/lazy-HASH.js'].raw);
    await put('dist/client/assets/new-ABCDEFGH.js', 'export const added = 1;');
    assert.equal(run().status, 1, 'new chunks must require an explicit budget');
    await put('dist/client/assets/.hidden.js', 'export const hidden = 1;');
    assert.equal(run().status, 1);
    const hidden = JSON.parse(await readFile(resolve(root, 'sizes.json'), 'utf8'));
    assert.ok(hidden.unknown.includes('dist/client/assets/.hidden.js'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolved boundary rules catch aliases, Node, frameworks, cycles and layer direction', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'replays-boundaries-'));
  try {
    const fixtures = {
      'src/client/a.ts': 'import "../server/a.ts"; import "@/cycle.ts";',
      'src/client/cycle.ts': 'import "./a.ts";',
      'src/client/types.ts': 'export type Api = string;',
      'src/server/a.ts': 'import "../client/a.ts"; import "../cli.ts";',
      'src/server/types.ts': 'import type { Api } from "../client/types.ts"; export type ServerApi = Api;',
      'src/shared/a.ts': 'import "../server/a.ts";',
      'src/recorder/a.ts': 'import "../server/a.ts"; import "react"; import "fs";',
      'src/recorder/a.test.ts': 'import "node:fs";',
      'src/plugin/a.ts': 'import "../server/a.ts";',
      'src/cli.ts': 'import "./client/a.ts";',
      'node_modules/react/package.json': '{"name":"react","main":"index.js"}',
      'node_modules/react/index.js': 'export const react = true;',
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/client/*'] } } }),
    };
    for (const [file, content] of Object.entries(fixtures)) {
      const path = resolve(root, file);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, content);
    }
    const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
    await writeFile(resolve(root, '.dependency-cruiser.cjs'), `module.exports = ${JSON.stringify(config)};`);
    const result = spawnSync(
      resolve('node_modules/.bin/depcruise'),
      ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', 'src'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const violations = JSON.parse(result.stdout).summary.violations;
    const found = new Set(violations.map((item) => item.rule.name));
    assert.ok(!found.has('no-unresolved'), 'aliases and packages must resolve');
    for (const rule of config.forbidden.filter((candidate) => candidate.name !== 'no-unresolved'))
      assert.ok(found.has(rule.name), `Missing ${rule.name}`);
    assert.ok(!violations.some((item) => item.from.endsWith('.test.ts')), 'Node test helpers are outside production boundaries');
    assert.ok(!violations.some((item) => item.from === 'src/server/types.ts'), 'server may import client type contracts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
