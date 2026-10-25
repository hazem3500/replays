import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { filtersFromSearch, INDEX_SUITES_URL, searchFromFilters } from '../src/client/ReplayIndex.tsx';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const preload =
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((source) => source.includes("'preload'")) ?? '';

/**
 * Runs index.html's preload script for a URL and returns the hrefs it preloads. `base` is what the server
 * declares in `<meta name="app-base">` (src/server/base-path.ts); absent, the app is at the root.
 */
function boot(url: string, base?: string) {
  const { pathname, search } = new URL(url, 'https://replays.example');
  const links: Array<Record<string, string>> = [];
  const document = {
    createElement: () => ({}) as Record<string, string>,
    head: { appendChild: (link: Record<string, string>) => links.push(link) },
    querySelector: (selector: string) => (selector === 'meta[name="app-base"]' && base !== undefined ? { content: base } : null),
  };
  new Function('location', 'document', preload)({ pathname, search }, document);
  for (const link of links) expect(link).toMatchObject({ rel: 'preload', as: 'fetch', crossOrigin: 'anonymous' });
  return links.map((link) => link.href);
}

describe('API preloads in index.html', () => {
  it('a replay preloads its bundle, at the URL the viewer fetches', () => {
    expect(boot('/r/suite-run-timer', '/')).toEqual([`/api/replays/${encodeURIComponent('suite-run-timer')}`]);
    expect(boot('/r/abc/', '/')).toEqual(['/api/replays/abc']);
  });

  it('a suite run preloads the suite and the run; a suite landing page only the suite', () => {
    expect(boot('/s/review-1/r/run%20one', '/')).toEqual(['/api/suites/review-1?expand=runs', '/api/replays/run%20one']);
    expect(boot('/s/review-1', '/')).toEqual(['/api/suites/review-1?expand=runs']);
    expect(boot('/r/run-2?suite=review-1', '/')).toEqual(['/api/suites/review-1?expand=runs', '/api/replays/run-2']);
  });

  it('the index preloads its list with the same filters the index sends, and its suites', () => {
    for (const search of [
      '',
      '?q=%20timer%20&errors=1&kind=suites&sort=-errors',
      '?source=human&host=example.com',
      '?tag=smoke&source=agent',
      '?source=bogus&errors=0',
      '?x-env=%20production%20&tag=smoke&x-area=checkout&x-env=other&X-bad=1&x-=1',
    ]) {
      const expected = `/api/replays${searchFromFilters(filtersFromSearch(search))}`;
      expect(boot(`/${search}`, '/')).toEqual([expected, `/api/${INDEX_SUITES_URL}`]);
    }
  });

  it('without a declared base the app is at the root', () => {
    expect(boot('/r/abc')).toEqual(['/api/replays/abc']);
    expect(boot('/s/review-1/r/run-1')).toEqual(['/api/suites/review-1?expand=runs', '/api/replays/run-1']);
  });

  it('under a path prefix the API lives under it too', () => {
    expect(boot('/replays/r/abc', '/replays')).toEqual(['/replays/api/replays/abc']);
    expect(boot('/replays/?errors=1', '/replays')).toEqual([
      `/replays/api/replays${searchFromFilters(filtersFromSearch('?errors=1'))}`,
      `/replays/api/${INDEX_SUITES_URL}`,
    ]);
  });

  it('a malformed id preloads nothing', () => {
    expect(boot('/r/%E0%A4%A', '/')).toEqual([]);
  });
});
