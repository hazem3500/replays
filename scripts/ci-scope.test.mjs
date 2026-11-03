import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CACHE_VERSION, E2E_LABEL, FULL_SCHEDULE, SUITES, suiteKey, suitesReason } from './ci-scope.mjs';

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
  'src/recorder/a.ts',
  'turbo.json',
  'stories/x.stories.tsx',
  'pnpm-lock.yaml',
  'package.json',
  '.github/workflows/ci.yml',
];

let directory;
let outputs;
let baseline;
const git = (...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: directory,
    encoding: 'utf8',
  });
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
function run(event, env = {}) {
  const output = join(outputs, `${event}-output`);
  const summary = join(outputs, `${event}-summary`);
  writeFileSync(output, '');
  writeFileSync(summary, '');
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'ci-scope.mjs')], {
    cwd: directory,
    env: {
      ...process.env,
      CI_EVENT: event,
      NODE_VERSION: '22',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
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

  it('rerun only the browser suite for the generated theme token contract', () => {
    assert.deepEqual(changedSuites('docs/tokens.md'), ['browser']);
  });

  it('leave bundle budgets and the Turborepo config to the PR gate', () => {
    assert.deepEqual(changedSuites('budgets/bundle.json'), []);
    assert.deepEqual(changedSuites('turbo.json'), []);
  });

  it('rerun only the end-to-end suite for an end-to-end spec', () => {
    assert.deepEqual(changedSuites('e2e/foo.spec.ts'), ['e2e']);
  });

  it('leave an ordinary unit test to the PR gate', () => {
    assert.deepEqual(changedSuites('test/x.test.ts'), []);
  });

  it('rerun the browser suite for a unit test the browser job runs', () => {
    assert.deepEqual(changedSuites('test/render.integration.test.ts'), ['browser']);
  });

  it('leave the Docker suite out of client changes except the file the image copies', () => {
    assert.deepEqual(changedSuites('src/client/a.ts'), ['e2e', 'browser']);
    assert.deepEqual(changedSuites('src/client/render/frames.ts'), ['e2e', 'browser', 'docker']);
  });

  it('rerun every suite for server code, the lockfile and the CI workflow', () => {
    for (const path of ['src/server/a.ts', 'pnpm-lock.yaml', '.github/workflows/ci.yml']) {
      assert.deepEqual(changedSuites(path), Object.keys(SUITES), path);
    }
  });

  it('rerun only the browser suite for a story', () => {
    assert.deepEqual(changedSuites('stories/x.stories.tsx'), ['browser']);
  });

  it('change with the Node version', () => {
    for (const suite of Object.keys(SUITES)) {
      assert.notEqual(key(suite, '22'), key(suite, '24'));
    }
  });
});

/** Why a pull request whose head changes `path` (against the fixture commit) runs the browser-backed suites. */
function reasonFor(path, options = {}) {
  write(path, `changed ${path}\n`);
  git('add', '-A');
  git('commit', '-qm', `change ${path}`);
  try {
    return suitesReason({ event: 'pull_request', base: 'HEAD~1', cwd: directory, ...options });
  } finally {
    git('reset', '-q', '--hard', 'HEAD~1');
  }
}

describe('browser-backed suites on pull requests', () => {
  it('stay off for ordinary source, unit test and workflow changes', () => {
    for (const path of ['src/server/a.ts', 'src/client/a.ts', 'test/x.test.ts', '.github/workflows/ci.yml']) {
      assert.equal(reasonFor(path), '', path);
    }
  });

  it('run for the recorder, render, packaging and dependency paths', () => {
    for (const path of ['src/recorder/a.ts', 'src/client/render/frames.ts', 'package.json', 'pnpm-lock.yaml']) {
      assert.match(reasonFor(path), new RegExp(`touches ${path}`), path);
    }
  });

  it('run for the label without any risky change', () => {
    assert.equal(reasonFor('test/x.test.ts', { labels: [E2E_LABEL] }), `labelled ${E2E_LABEL}`);
  });

  it('run when the base commit is unknown', () => {
    assert.notEqual(suitesReason({ event: 'pull_request', base: '', cwd: directory }), '');
  });

  it('always run outside pull requests', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch']) assert.notEqual(suitesReason({ event, cwd: directory }), '', event);
  });
});

describe('command line', () => {
  it('forces a full run for the weekly schedule and manual events only', () => {
    assert.equal(run('schedule', { CI_SCHEDULE: FULL_SCHEDULE }).values.force, 'true');
    assert.equal(run('schedule', { CI_SCHEDULE: '23 3 * * 0,2-6' }).values.force, 'false');
    assert.equal(run('workflow_dispatch').values.force, 'true');
    assert.equal(run('push').values.force, 'false');
  });

  it('writes one content-addressed key per marker, shared by the end-to-end shards', () => {
    const { values, summary } = run('pull_request', { CI_BASE: 'HEAD' });
    assert.deepEqual(Object.keys(values).sort(), ['browser', 'docker', 'e2e-1', 'e2e-2', 'e2e-3', 'force', 'wanted']);
    for (const shard of [1, 2, 3]) assert.equal(values[`e2e-${shard}`], `ci-pass-${CACHE_VERSION}-e2e-${shard}-${key('e2e')}`);
    assert.match(values.docker, new RegExp(`^ci-pass-${CACHE_VERSION}-docker-[0-9a-f]{64}$`));
    assert.equal(values.wanted, 'false');
    assert.match(summary, /\| e2e-2 \| e2e \|/);
  });

  it('wants the suites for a labelled pull request', () => {
    assert.equal(run('pull_request', { CI_BASE: 'HEAD', CI_LABELS: JSON.stringify([E2E_LABEL]) }).values.wanted, 'true');
  });
});
