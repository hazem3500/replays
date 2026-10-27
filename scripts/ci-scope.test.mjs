import assert from 'node:assert/strict';
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
