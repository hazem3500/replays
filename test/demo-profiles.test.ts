import { describe, expect, it } from 'vitest';

import { inferDesignReview, inferTriage, inferWalkthrough } from '../examples/demo-profiles/plugin.ts';
import type { ProfileInferInput } from '../src/plugin/index.ts';

function summary(extra: Partial<ProfileInferInput> = {}): ProfileInferInput {
  return {
    id: 'demo-replay',
    title: 'Signup flow',
    url: 'https://demo.test/signup',
    host: 'demo.test',
    capturedAt: '2026-10-01T00:00:00.000Z',
    duration: 1000,
    steps: 3,
    consoleErrors: 0,
    failedRequests: 0,
    errors: 0,
    source: 'agent',
    ...extra,
  };
}

describe('demo profile inference', () => {
  it('sends console and request errors to triage', () => {
    expect(inferTriage(summary({ errors: 1 }))).toBe(true);
    expect(inferTriage(summary())).toBe(false);
  });

  it('recognizes suite runs and review/design metadata', () => {
    expect(inferDesignReview(summary({ suiteRun: { suiteId: 'release', runId: 'run-1' } }))).toBe(true);
    expect(inferDesignReview(summary({ title: 'Design handoff' }))).toBe(true);
    expect(inferDesignReview(summary({ tags: ['review'] }))).toBe(true);
    expect(inferDesignReview(summary())).toBe(false);
  });

  it('recognizes walkthrough steps only when there are no errors', () => {
    expect(inferWalkthrough(summary())).toBe(true);
    expect(inferWalkthrough(summary({ steps: 0 }))).toBe(false);
    expect(inferWalkthrough(summary({ errors: 1 }))).toBe(false);
  });
});
