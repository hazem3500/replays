import { describe, expect, it } from 'vitest';

import { compareDefaults } from '../src/client/compare/defaults.ts';

describe('compare defaults', () => {
  it('opens a suite with two or more recordings compared in a grid', () => {
    expect(compareDefaults({ page: 'suite', recordings: 3 })).toEqual({ compare: true, layout: 'grid' });
  });

  it('spotlights the run a suite link names', () => {
    expect(compareDefaults({ page: 'suite', recordings: 2, namedRecording: true })).toEqual({ compare: true, layout: 'spotlight' });
  });

  it('keeps a suite with one recording, and a replay on its own, in the single viewer', () => {
    expect(compareDefaults({ page: 'suite', recordings: 1, namedRecording: true })).toEqual({ compare: false, layout: 'single' });
    expect(compareDefaults({ page: 'replay', recordings: 1 })).toEqual({ compare: false, layout: 'single' });
  });
});
