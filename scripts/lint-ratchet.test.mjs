import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentCounts, countsFor, increases } from './lib/lint-report.mjs';

describe('lint debt ratchet', () => {
  it('blocks a new rule and a rising count even when total debt falls', () => {
    assert.deepEqual(increases({ old: 1, rising: 3, new: 1 }, { old: 10, rising: 2 }), ['rising: 2 → 3', 'new: 0 → 1']);
  });
  it('allows decreases and removed rules', () => {
    assert.deepEqual(increases({ existing: 1 }, { existing: 2, removed: 1 }), []);
  });
  it('keeps comment allowances attached to their original file', () => {
    const report = {
      diagnostics: [
        { code: 'replays(comment-policy)', filename: 'src/existing.ts' },
        { code: 'replays(comment-policy)', filename: 'src/new.ts' },
        { code: 'eslint(no-unused-vars)', filename: 'src/new.ts' },
      ],
    };
    assert.deepEqual(increases(commentCounts(report), { 'src/existing.ts': 2 }), ['src/new.ts: 0 → 1']);
    assert.equal(countsFor(report)['replays(comment-policy)'], 2);
  });
});

it('tolerates a small rise when given a tolerance', () => {
  assert.deepEqual(increases({ a: 5, b: 20 }, { a: 2, b: 5 }, () => 10), ['b: 5 → 20']);
});

it('refuses an unspecified comparison base instead of silently checking zero files', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/lint-new-files.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, LINT_BASE_REF: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass --base/);
});

it('blocks an added file at final strictness and refuses an index/worktree mismatch', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'replays-added-lint-'));
  const script = resolve('scripts/lint-new-files.mjs');
  try {
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(
      join(root, '.oxlintrc.next.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        plugins: ['typescript'],
        rules: { 'typescript/no-explicit-any': 'warn' },
      }),
    );
    writeFileSync(join(root, '.oxlintrc.types.next.json'), JSON.stringify({ categories: { correctness: 'off' }, rules: {} }));
    mkdirSync(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/added.ts');
    writeFileSync(path, 'export const value: any = 1;\n');
    for (const args of [
      ['init', '-q'],
      ['add', 'src/added.ts'],
    ]) {
      assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
    }
    const blocked = spawnSync(process.execPath, [script, '--staged'], { cwd: root, encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /no-explicit-any/);
    writeFileSync(path, 'export const value = 1;\n');
    const mismatch = spawnSync(process.execPath, [script, '--staged'], { cwd: root, encoding: 'utf8' });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /Restage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('audits the TypeScript project without parsing unsupported JavaScript', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'replays-project-lint-'));
  const helper = new URL('./lib/lint-report.mjs', import.meta.url).href;
  try {
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ include: ['included.ts'] }));
    writeFileSync(join(root, 'included.ts'), 'export const value: any = 1;\n');
    writeFileSync(join(root, 'unsupported.js'), 'not valid JavaScript !');
    writeFileSync(join(root, 'lint.json'), JSON.stringify({ plugins: ['typescript'], rules: { 'typescript/no-explicit-any': 'warn' } }));
    const code = `import {runLint} from ${JSON.stringify(helper)}; console.log(JSON.stringify(runLint('lint.json', {types:true})));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.number_of_files, 1);
    assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code.includes('no-explicit-any')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
