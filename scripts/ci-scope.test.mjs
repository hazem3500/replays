import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { selectChecks } from './ci-scope.mjs';

test('only documentation can skip every runtime job', () => {
  assert.deepEqual(selectChecks(['README.md', 'docs/tooling.md'], 'pull_request'), { runtime: false, storybook: false });
  for (const file of ['docs/formats/replay.schema.json', '.github/workflows/ci.yml', 'pnpm-lock.yaml', 'src/fixture.md']) {
    assert.deepEqual(selectChecks(['README.md', file], 'pull_request'), { runtime: true, storybook: true });
  }
});

test('stories retain integration and type checks but do not trigger runtime checks', () => {
  assert.deepEqual(selectChecks(['stories/Button.stories.tsx', '.storybook/main.ts', 'docs/tooling.md'], 'pull_request'), {
    runtime: false,
    storybook: true,
  });
  assert.deepEqual(selectChecks(['stories/Button.stories.tsx', 'src/client/main.tsx'], 'pull_request'), {
    runtime: true,
    storybook: true,
  });
});

test('main, nightly and unknown or empty changes run everything', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch', 'pull_request']) {
    assert.deepEqual(selectChecks([], event), { runtime: true, storybook: true });
  }
  assert.deepEqual(selectChecks(['README.md'], 'push'), { runtime: true, storybook: true });
});

test('renaming runtime code into documentation still checks the removed code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'replays-ci-scope-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: directory, encoding: 'utf8' },
    ).trim();
  try {
    git('init', '-q');
    git('config', 'diff.renames', 'true');
    writeFileSync(join(directory, 'runtime.ts'), 'export const runtime = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'source');
    const base = git('rev-parse', 'HEAD');
    renameSync(join(directory, 'runtime.ts'), join(directory, 'README.md'));
    git('add', '-A');
    git('commit', '-qm', 'rename');
    const output = join(directory, 'scope-output');
    execFileSync(process.execPath, [resolve(import.meta.dirname, 'ci-scope.mjs')], {
      cwd: directory,
      env: { ...process.env, CI_EVENT: 'pull_request', PR_BASE: base, PR_HEAD: git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output },
    });
    assert.match(readFileSync(output, 'utf8'), /runtime=true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
