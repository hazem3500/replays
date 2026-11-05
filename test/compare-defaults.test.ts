import { describe, expect, it } from 'vitest';

import { compareDefaults } from '../src/client/compare/defaults.ts';
import { parseCompareSearch, writeCompareSearch } from '../src/client/compare/compare-search.ts';

describe('compare defaults', () => {
  it('opens a multi-run suite in single while retaining its layout controls', () => {
    expect(compareDefaults({ page: 'suite', recordings: 4 })).toEqual({ compare: true, layout: 'single' });
  });

  it('does not escalate a named run to spotlight', () => {
    expect(compareDefaults({ page: 'suite', recordings: 4, namedRecording: true })).toEqual({ compare: true, layout: 'single' });
  });

  it('uses an intentionally requested comparison view', () => {
    expect(compareDefaults({ page: 'suite', recordings: 4, viewLayout: 'grid' })).toEqual({ compare: true, layout: 'grid' });
  });

  it('lets explicit single override the comparison view', () => {
    const defaults = compareDefaults({ page: 'suite', recordings: 4, viewLayout: 'grid' });
    expect(parseCompareSearch('?view=compare&layout=single', '', defaults.layout).layout).toBe('single');
  });

  it('retains explicit comparisons on ordinary suite entry', () => {
    const defaults = compareDefaults({ page: 'suite', recordings: 4 });
    expect(parseCompareSearch('?layout=spotlight', '', defaults.layout).layout).toBe('spotlight');
  });

  it('round-trips single back to grid without dropping other URL preferences', () => {
    const single = writeCompareSearch('?view=compare&t=3', { with: [], layout: 'single' }, 'grid');
    expect(parseCompareSearch(single, '', 'grid').layout).toBe('single');
    const grid = writeCompareSearch(single, { with: [], layout: 'grid' }, 'grid');
    expect(parseCompareSearch(grid, '', 'grid').layout).toBe('grid');
    expect(new URLSearchParams(grid).get('view')).toBe('compare');
    expect(new URLSearchParams(grid).get('t')).toBe('3');
  });

  it('keeps a one-recording suite in the plain viewer', () => {
    expect(compareDefaults({ page: 'suite', recordings: 1, namedRecording: true })).toEqual({ compare: false, layout: 'single' });
  });

  it('keeps a replay on its own in the plain viewer', () => {
    expect(compareDefaults({ page: 'replay', recordings: 1 })).toEqual({ compare: false, layout: 'single' });
  });
});
