import { describe, expect, it } from 'vitest';

import { MAX_RECORDINGS, parseCompareSearch, writeCompareSearch } from '../src/client/compare/search.ts';

describe('compare search', () => {
  it('reads the recordings, layout and focus from a viewer URL', () => {
    expect(parseCompareSearch('?with=b,c&layout=spotlight&focus=c', 'a')).toEqual({ with: ['b', 'c'], layout: 'spotlight', focus: 'c' });
  });

  it('shows one recording at a time without a layout, or the page default', () => {
    expect(parseCompareSearch('?with=b', 'a').layout).toBe('single');
    expect(parseCompareSearch('', '', 'grid').layout).toBe('grid');
    expect(parseCompareSearch('?layout=gallery', 'a').layout).toBe('single');
  });

  it('drops the page’s own id, repeats, invalid ids and ids past the stage’s capacity', () => {
    const many = Array.from({ length: 12 }, (_, index) => `r${index}`).join(',');
    expect(parseCompareSearch('?with=a,b,b,../x', 'a').with).toEqual(['b']);
    expect(parseCompareSearch(`?with=${many}`, 'a').with).toHaveLength(MAX_RECORDINGS - 1);
  });

  it('ignores a focus on a recording that is not on the stage', () => {
    expect(parseCompareSearch('?with=b&focus=z', 'a')).not.toHaveProperty('focus');
    expect(parseCompareSearch('?with=b&focus=a', 'a').focus).toBe('a');
  });

  it('writes compare keys while keeping the playhead and leaving defaults out', () => {
    const written = writeCompareSearch('?t=4.0&layout=grid', { with: ['b', 'c'], layout: 'grid', focus: 'b' });
    expect(written).toBe('?t=4.0&with=b,c&layout=grid&focus=b');
    expect(writeCompareSearch('?with=b&layout=grid', { with: [], layout: 'single' })).toBe('');
    expect(writeCompareSearch('?layout=single', { with: [], layout: 'grid' }, 'grid')).toBe('');
  });

  it('round-trips what it writes', () => {
    const state = { with: ['b', 'c'], layout: 'spotlight' as const, focus: 'c' };
    expect(parseCompareSearch(writeCompareSearch('', state), 'a')).toEqual(state);
  });
});
