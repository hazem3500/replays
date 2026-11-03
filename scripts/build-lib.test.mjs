import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/build-lib.mjs');
const originalExports = {
  '.': { types: './dist/types/index.d.ts', default: './dist/lib/index.mjs' },
  './viewer': { types: './dist/types/client/plugins/api.d.ts', default: './dist/lib/viewer.mjs' },
};

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'replays-library-baseline-'));
  const put = async (file, contents) => {
    await mkdir(resolve(root, file, '..'), { recursive: true });
    await writeFile(resolve(root, file), contents);
  };
  await put('package.json', JSON.stringify({ type: 'module', exports: originalExports }));
  await put('src/index.ts', 'export const legacy = true;');
  await put('src/client/plugins/api.ts', 'export const viewer = true;');
  await put('src/capture/injected-recorder.ts', 'globalThis.recorderFixture = true;');
  return { root, put };
}

function rebuild(root) {
  return spawnSync(process.execPath, [script], { env: { ...process.env, REPLAYS_BUILD_ROOT: root }, encoding: 'utf8' });
}

test('baseline metadata uses its own exports without requiring or adding feature entries or CSS', async () => {
  const { root, put } = await fixture();
  try {
    await put('src/shared/model.ts', 'export const headOnly = true;');
    await put('src/client/compose/stage.css', '.feature-only { color: red; }');
    const result = rebuild(root);
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(resolve(root, 'dist/lib'));
    assert.ok(files.includes('index.mjs'));
    assert.ok(files.includes('viewer.mjs'));
    assert.ok(!files.includes('model.mjs'));
    assert.ok(!files.includes('viewer-playback.mjs'));
    assert.ok(!files.some((file) => file.endsWith('.css')));
    const metadata = JSON.parse(await readFile(resolve(root, 'dist/lib/.metafile.json'), 'utf8'));
    assert.ok(Object.keys(metadata.inputs).every((file) => !file.includes('shared/model') && !file.includes('compose/')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('baseline metadata refuses to silently omit an exported entry whose source is missing', async () => {
  const { root, put } = await fixture();
  try {
    await put('package.json', JSON.stringify({ exports: { ...originalExports, './model': './dist/lib/model.mjs' } }));
    const result = rebuild(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shared\/model\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('normal builds still require every configured head entry even when the package only exports legacy entries', async () => {
  const { root } = await fixture();
  try {
    await mkdir(resolve(root, 'scripts'), { recursive: true });
    await copyFile(script, resolve(root, 'scripts/build-lib.mjs'));
    await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
    const env = { ...process.env };
    delete env.REPLAYS_BUILD_ROOT;
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/build-lib.mjs')], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shared\/model\.ts|client\/playback\/index\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('baseline metadata rebuilds only CSS explicitly exported by that checkout', async () => {
  const { root, put } = await fixture();
  try {
    await put('package.json', JSON.stringify({ exports: { ...originalExports, './player.css': './dist/lib/viewer-playback.css' } }));
    await put('src/client/playback/playback.css', '.recorded-page { overflow: hidden; }');
    await put('src/client/compose/stage.css', '.feature-only { color: red; }');
    const result = rebuild(root);
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(resolve(root, 'dist/lib'));
    assert.ok(files.includes('viewer-playback.css'));
    assert.ok(!files.includes('viewer-react.css'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
