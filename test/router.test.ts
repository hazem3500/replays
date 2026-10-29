// @vitest-environment happy-dom
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiUrl } from '../src/client/api/fetch.ts';
import { setBetaEditorForTests } from '../src/client/config.ts';
import { createAppRouter } from '../src/client/router.tsx';
import { editHref, indexHref, isAppPage, replayHref, replayInSuiteHref, suiteHref, suiteRunOf } from '../src/client/routing/links.ts';
import { pageOf } from '../src/client/routing/page-key.ts';

/** The app's router on `path` (a public address), as the browser would open it under `base`. */
async function open(path: string, base = '') {
  setBase(base);
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  const router = createAppRouter({
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    deployment: { base, name: 'replays' },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const leaf = router.state.matches.at(-1);
  return { router, routeId: leaf?.routeId, params: leaf?.params, href: router.state.location.publicHref };
}

function setBase(base: string) {
  document.head.querySelector('meta[name="app-base"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'app-base';
  meta.content = base || '/';
  document.head.append(meta);
}

/** Registers the enclosing describe's cleanup: the beta flag and stubbed globals go back to their defaults. */
function useRouterHarness() {
  afterEach(() => {
    setBetaEditorForTests(undefined);
    vi.unstubAllGlobals();
  });
}

describe('addresses under either base', () => {
  useRouterHarness();

  it('builds links and API URLs at the root of a domain', () => {
    setBase('');
    expect([indexHref(), replayHref('a b'), editHref('a'), suiteHref('s'), replayInSuiteHref('r', 's'), apiUrl('replays')]).toEqual([
      '/',
      '/r/a%20b',
      '/r/a/edit',
      '/s/s',
      '/s/s/r/r',
      '/api/replays',
    ]);
  });

  it('builds links and API URLs under a path prefix', () => {
    setBase('/replays');
    expect([indexHref(), replayHref('a'), apiUrl('me')]).toEqual(['/replays/', '/replays/r/a', '/replays/api/me']);
  });

  it('routes only the app’s own pages, never its API, assets or other paths on the host', () => {
    setBase('/replays');
    expect(isAppPage('/replays/r/a')).toBe(true);
    for (const other of ['/replays/api/replays', '/replays/assets/main.js', '/replays/healthz', '/replays/render.html', '/elsewhere/r/a'])
      expect(isAppPage(other)).toBe(false);
  });

  it('reads the suite and run of a popped address', () => {
    setBase('/replays');
    expect(suiteRunOf('/replays/s/review%20123/r/capture%201/')).toEqual({ suiteId: 'review 123', replayId: 'capture 1' });
    expect(suiteRunOf('/replays/s/review-1')).toEqual({ suiteId: 'review-1' });
    expect(suiteRunOf('/replays/r/a')).toBeUndefined();
  });
});

describe('routes', () => {
  useRouterHarness();

  it('opens a replay, at the root and under a base path', async () => {
    expect(await open('/r/example-dot-com')).toMatchObject({ routeId: '/r/$id/', params: { id: 'example-dot-com' } });
    expect(await open('/replays/r/a', '/replays')).toMatchObject({ routeId: '/r/$id/', params: { id: 'a' }, href: '/replays/r/a' });
  });

  it('opens the index at the root and under a base path', async () => {
    expect((await open('/')).routeId).toBe('/');
    expect(await open('/replays/', '/replays')).toMatchObject({ routeId: '/', href: '/replays/' });
  });

  it('opens a suite on its own and on one of its runs', async () => {
    expect(await open('/s/review-123')).toMatchObject({ routeId: '/s/$suiteId/', params: { suiteId: 'review-123' } });
    expect(await open('/s/review%20123/r/capture%201')).toMatchObject({
      routeId: '/s/$suiteId/r/$replayId',
      params: { suiteId: 'review 123', replayId: 'capture 1' },
    });
  });

  it('keeps query strings exactly as written', async () => {
    expect((await open('/?q=login&errors=1&sort=-duration&x-team=web')).href).toBe('/?q=login&errors=1&sort=-duration&x-team=web');
    expect((await open('/r/a?t=12.5&with=b,c&layout=grid#step-2')).href).toBe('/r/a?t=12.5&with=b,c&layout=grid#step-2');
  });

  it('reads compare keys as compare-search.ts does, dropping what the viewer would ignore', async () => {
    const { router } = await open('/r/a?with=b,b,c&layout=gallery&t=3');
    expect(router.state.matches.at(-1)?.search).toMatchObject({ with: 'b,c', layout: undefined, t: '3' });
  });

  it('opens a plugin page with its path and query', async () => {
    expect(await open('/p/reports/weekly/2026?team=web')).toMatchObject({
      routeId: '/p/$plugin/$',
      params: { plugin: 'reports', _splat: 'weekly/2026' },
      href: '/p/reports/weekly/2026?team=web',
    });
  });

  it('matches no page for an address that is none (the not-found page shows)', async () => {
    const { router } = await open('/nowhere/at/all');
    expect(router.state.matches.map((match) => match.routeId)).toEqual(['__root__']);
  });
});

describe('edit mode', () => {
  useRouterHarness();

  it('opens the editor when editing is enabled', async () => {
    setBetaEditorForTests(true);
    expect(await open('/r/demo-shop/edit')).toMatchObject({ routeId: '/r/$id/edit', params: { id: 'demo-shop' } });
  });

  it('has no edit page without edit capability', async () => {
    setBetaEditorForTests(false);
    const { router } = await open('/r/demo-shop/edit');
    expect(router.state.matches.at(-1)?.status).toBe('notFound');
  });
});

describe('pages', () => {
  useRouterHarness();

  it('treats a suite’s runs as one page and a replay’s edit mode as another', async () => {
    const { router } = await open('/');
    expect(pageOf(router, '/s/x/r/a').key).toBe(pageOf(router, '/s/x').key);
    expect(pageOf(router, '/r/a/edit').key).not.toBe(pageOf(router, '/r/a').key);
    expect(pageOf(router, '/').kind).toBe('index');
  });
});
