import { describe, expect, it } from 'vitest';

import { compareDefaults, isComparisonView, suiteViewLayout } from '../src/client/compare/defaults.ts';
import { parseCompareSearch, writeCompareSearch } from '../src/client/compare/compare-search.ts';

const view = (layout?: 'single' | 'grid') => ({ id: 'v', label: 'V', order: 0, ...(layout ? { layout } : {}) });

describe('compare defaults', () => {
  it('opens a multi-run suite in single while retaining its layout controls', () => {
    expect(compareDefaults({ page: 'suite', recordings: 4 })).toEqual({ compare: true, layout: 'single' });
  });

  it('does not use an implicit grid preset to escalate ordinary entry', () => {
    expect(suiteViewLayout({ source: 'recordings', view: { id: 'standard', label: 'Standard', order: 0, layout: 'grid' } })).toBe('single');
  });

  for (const source of ['url', 'suite', 'replay'] as const) {
    for (const layout of ['grid', 'spotlight'] as const) {
      it(`retains a custom ${source} view's explicit ${layout} layout`, () => {
        const fallback = suiteViewLayout({ source, view: { id: 'custom', label: 'Custom', order: 0, layout } });
        expect(compareDefaults({ page: 'suite', recordings: 4, viewLayout: fallback }).layout).toBe(layout);
        expect(parseCompareSearch('?layout=single', '', fallback).layout).toBe('single');
      });
    }
  }

  it('keeps profile views without comparison layout in single', () => {
    expect(suiteViewLayout({ source: 'suite', view: { id: 'triage', label: 'Triage', order: 0 } })).toBe('single');
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

  it('treats only an explicitly chosen multi-recording layout as a comparison suite', () => {
    expect(isComparisonView({ source: 'suite', view: view('grid') })).toBe(true);
    expect(isComparisonView({ source: 'url', view: view('grid') })).toBe(true);
    expect(isComparisonView({ source: 'suite', view: view() })).toBe(false);
    expect(isComparisonView({ source: 'suite', view: view('single') })).toBe(false);
    expect(isComparisonView({ source: 'recordings', view: view('grid') })).toBe(false);
  });

  it('keeps a one-recording suite in the plain viewer', () => {
    expect(compareDefaults({ page: 'suite', recordings: 1 })).toEqual({ compare: false, layout: 'single' });
  });

  it('keeps a replay on its own in the plain viewer', () => {
    expect(compareDefaults({ page: 'replay', recordings: 1 })).toEqual({ compare: false, layout: 'single' });
  });
});
