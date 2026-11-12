import { describe, expect, it } from 'vitest';

import { charBudget, isIdSegment, labelSegments, markWords, searchWords, shortenPath } from '../src/client/viewer/network/request-label.ts';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('request label', () => {
  it('tells ids from names', () => {
    expect(['42', UUID, 'a1b2c3d4e5f60718', 'workspaces', 'v2', 'deadbeef'].map(isIdSegment)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('drops the query and the hash and swaps ids for :id', () => {
    expect(labelSegments(`/api/organizations/${UUID}/projects/7?include=members#top`)).toEqual([
      'api',
      'organizations',
      ':id',
      'projects',
      ':id',
    ]);
    expect(shortenPath('/api/projects/7?x=1')).toBe('/api/projects/:id');
  });

  it('leaves a short path unchanged', () => {
    expect(shortenPath('/api/me', 40)).toBe('/api/me');
    expect(shortenPath('/', 4)).toBe('/');
    expect(shortenPath('/api/workspaces/:id/search', 40)).toBe('/api/workspaces/:id/search');
  });

  it('keeps the first segment and the last three when the path does not fit', () => {
    expect(shortenPath(`/api/organizations/${UUID}/workspaces/12/search`, 30)).toBe('/api/…/workspaces/:id/search');
  });

  it('falls back to the last segment, then never cuts below the tightest form', () => {
    expect(shortenPath('/api/organizations/workspaces/search', 18)).toBe('/api/…/search');
    expect(shortenPath('/api/organizations/workspaces/search', 5)).toBe('/api/…/search');
  });

  it('cuts nothing without a budget, and measures a budget from a width', () => {
    expect(shortenPath('/api/a/b/c/d/e/f/g/h/i/j/k')).toBe('/api/a/b/c/d/e/f/g/h/i/j/k');
    expect(charBudget(0, 7)).toBeUndefined();
    expect(charBudget(140, 7)).toBe(20);
    expect(charBudget(20, 7)).toBe(8);
  });

  it('keeps the segment a search matches when it shortens', () => {
    const words = searchWords('  Organizations ');
    expect(words).toEqual(['organizations']);
    expect(shortenPath('/api/organizations/workspaces/search', 18)).toBe('/api/…/search');
    expect(shortenPath('/api/organizations/workspaces/search', 18, words)).toBe('/api/organizations/…/search');
    expect(shortenPath('/api/a/b/c/d/e/f/g/h/i/j/k', 12, ['e'])).toBe('/api/…/e/…/k');
    // why: a word that only spans a slash marks no segment, so the label shortens as before.
    expect(shortenPath('/api/organizations/workspaces/search', 18, ['s/w'])).toBe('/api/…/search');
  });

  it('marks every search word in a label, ignoring case', () => {
    expect(markWords('api.Example.com', ['example'])).toEqual([
      { text: 'api.', hit: false },
      { text: 'Example', hit: true },
      { text: '.com', hit: false },
    ]);
    expect(markWords('plain', [])).toEqual([{ text: 'plain', hit: false }]);
  });
});
