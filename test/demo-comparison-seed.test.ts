import { describe, expect, it } from 'vitest';

import { createComparisonSeed } from '../scripts/demo-comparison-seed.mjs';
import { assertReplayBundle } from '../src/shared/replay.ts';

describe('demo comparison seed', () => {
  const { replays, suites } = createComparisonSeed();
  const byId = new Map(replays.map((replay) => [replay.meta.id, replay]));
  const lcp = (id: string | undefined) =>
    byId.get(id ?? '')?.performance?.entries.find((entry) => entry.kind === 'largest-contentful-paint')?.value ?? Number.NaN;

  it('ships the suites the viewer comparison is demonstrated with', () => {
    expect(suites.map((suite) => [suite.id, suite.runs.length])).toEqual([
      ['demo-compare-performance', 2],
      ['demo-compare-design', 2],
      ['demo-compare-browsers', 4],
      ['demo-compare-nightly', 6],
    ]);
  });

  it('gives every run its own recording, titled after that run', () => {
    const titles = suites.flatMap((suite) => suite.runs.map((run) => [byId.get(run.replayId ?? '')?.meta.title, `${suite.title} · ${run.label}`]));
    for (const [actual, expected] of titles) expect(actual).toBe(expected);
  });

  it('writes valid, distinct, fictional bundles', () => {
    expect(byId.size).toBe(replays.length);
    for (const replay of replays) {
      expect(() => assertReplayBundle(replay)).not.toThrow();
      expect(replay.context?.fields?.fictional).toBe(true);
    }
  });

  it('makes the performance suite’s Before slower than its After', () => {
    const [before, after] = suites[0]?.runs ?? [];
    expect(lcp(before?.replayId)).toBeGreaterThan(lcp(after?.replayId));
  });
});
