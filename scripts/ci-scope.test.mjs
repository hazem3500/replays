import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CACHE_VERSION, SUITES, suiteKey } from './ci-scope.mjs';

const FILES = [
  'README.md',
  'docs/guide.md',
  'docs/tokens.md',
  'budgets/bundle.json',
  'e2e/foo.spec.ts',
  'test/x.test.ts',
  'test/render.integration.test.ts',
  'src/client/a.ts',
  'src/client/render/frames.ts',
  'src/server/a.ts',
  'stories/x.stories.tsx',
  'pnpm-lock.yaml',
  'package.json',
  '.github/workflows/ci.yml',
];

let directory;
let outputs;
let baseline;
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory, encoding: 'utf8' });
const write = (path, content) => {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), content);
};
const key = (suite, nodeVersion = '22') => suiteKey(suite, { cwd: directory, nodeVersion });
const keys = () => Object.fromEntries(Object.keys(SUITES).map((suite) => [suite, key(suite)]));

/** Suites whose key moves when `path` gets new content, relative to the committed fixture. */
function changedSuites(path) {
  write(path, `changed ${path}\n`);
  git('add', '-A');
  const changed = keys();
  git('reset', '-q', '--hard', 'HEAD');
  return Object.keys(SUITES).filter((suite) => changed[suite] !== baseline[suite]);
}

/** Runs the CLI in the fixture repo for `event` and returns its parsed outputs and step summary. */
function run(event) {
  const output = join(outputs, `${event}-output`);
  const summary = join(outputs, `${event}-summary`);
  writeFileSync(output, '');
  writeFileSync(summary, '');
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'ci-scope.mjs')], {
    cwd: directory,
    env: { ...process.env, CI_EVENT: event, NODE_VERSION: '22', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
  });
  const lines = readFileSync(output, 'utf8').trim().split('\n');
  const values = Object.fromEntries(lines.map((line) => line.split('=')));
  return { values, summary: readFileSync(summary, 'utf8') };
}

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'replays-ci-scope-'));
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('config', 'commit.gpgsign', 'false');
  for (const path of FILES) write(path, `original ${path}\n`);
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  baseline = keys();
  outputs = mkdtempSync(join(tmpdir(), 'replays-ci-scope-output-'));
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(outputs, { recursive: true, force: true });
});

describe('suite keys', () => {
  it('ignore root and docs Markdown', () => {
    assert.deepEqual(changedSuites('README.md'), []);
    assert.deepEqual(changedSuites('docs/guide.md'), []);
  });

  it('rerun checks and browser suites for the generated theme token contract', () => {
    assert.deepEqual(changedSuites('docs/tokens.md'), ['checks', 'browser']);
  });

  it('rerun only the checks suite for bundle budgets, which format check reads', () => {
    assert.deepEqual(changedSuites('budgets/bundle.json'), ['checks']);
  });

  it('rerun checks and end-to-end suites for an end-to-end spec', () => {
    assert.deepEqual(changedSuites('e2e/foo.spec.ts'), ['checks', 'e2e']);
  });

  it('rerun only the checks suite for an ordinary unit test', () => {
    assert.deepEqual(changedSuites('test/x.test.ts'), ['checks']);
  });

  it('rerun checks and browser suites for a unit test the browser job runs', () => {
    assert.deepEqual(changedSuites('test/render.integration.test.ts'), ['checks', 'browser']);
  });

  it('leave the Docker suite out of client changes except the file the image copies', () => {
    assert.deepEqual(changedSuites('src/client/a.ts'), ['checks', 'e2e', 'browser']);
    assert.deepEqual(changedSuites('src/client/render/frames.ts'), ['checks', 'e2e', 'browser', 'docker']);
  });

  it('rerun every suite for server code, the lockfile and the CI workflow', () => {
    for (const path of ['src/server/a.ts', 'pnpm-lock.yaml', '.github/workflows/ci.yml']) {
      assert.deepEqual(changedSuites(path), Object.keys(SUITES), path);
    }
  });

  it('rerun checks and browser suites for a story', () => {
    assert.deepEqual(changedSuites('stories/x.stories.tsx'), ['checks', 'browser']);
  });

  it('change with the Node version', () => {
    for (const suite of Object.keys(SUITES)) {
      assert.notEqual(key(suite, '22'), key(suite, '24'));
    }
  });
});

describe('command line', () => {
  it('forces a full run for scheduled and manual events only', () => {
    assert.equal(run('schedule').values.force, 'true');
    assert.equal(run('workflow_dispatch').values.force, 'true');
    assert.equal(run('push').values.force, 'false');
  });

  it('writes one content-addressed key per marker, shared by the end-to-end shards', () => {
    const { values, summary } = run('pull_request');
    assert.deepEqual(Object.keys(values).sort(), ['browser', 'checks', 'docker', 'e2e-1', 'e2e-2', 'e2e-3', 'force']);
    for (const shard of [1, 2, 3]) assert.equal(values[`e2e-${shard}`], `ci-pass-${CACHE_VERSION}-e2e-${shard}-${key('e2e')}`);
    assert.equal(values.checks, `ci-pass-${CACHE_VERSION}-checks-${key('checks')}`);
    assert.match(values.docker, new RegExp(`^ci-pass-${CACHE_VERSION}-docker-[0-9a-f]{64}$`));
    assert.match(summary, /\| e2e-2 \| e2e \|/);
  });
});
