import { matchesFilters, type ReplayFilters, type ReplaySummary } from '../../src/shared/replay.ts';
import type { ReviewSuiteIndexEntry } from '../../src/shared/review-suite.ts';
import { emptyReplay, replay, samples, summaries, suite } from './replays.ts';

export type ApiState = 'ready' | 'empty' | 'loading' | 'error' | 'signin' | 'unavailable' | 'dense';
export interface MockApi {
  state?: ApiState;
  credentials?: boolean;
  recorderPlayground?: boolean;
  save?: 'error' | 'saving';
  summaries?: ReplaySummary[];
  suites?: ReviewSuiteIndexEntry[];
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// Installed before React mounts; restored by Storybook after each story. Unknown API calls fail closed.
export function installApi({
  state = 'ready',
  credentials = false,
  recorderPlayground = false,
  save,
  summaries: librarySummaries = summaries,
  suites = [suite],
}: MockApi = {}) {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!url.pathname.includes('/api/')) return original(input, init);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname.endsWith('/api/storybook-checkout-failure')) return json({ error: 'Checkout fixture failure' }, 500);
    // Embedded Viewer metadata remains mocked even when recorder upload uses the real transport.
    if (url.pathname.endsWith('/keep')) return json({ expiresAt: null, committed: false });
    if (recorderPlayground && init?.method === 'POST') return original(input, init);
    if (state === 'loading')
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    if (state === 'error') return json({ error: 'Story fixture: service temporarily unavailable' }, 500);
    if (state === 'signin') return json({ error: 'Sign in required' }, 401);
    const path = url.pathname.split('/api/')[1] ?? '';
    if (path.endsWith('/edits') && init?.method === 'PUT') {
      if (save === 'error') return json({ error: 'Fixture save failure' }, 500);
      if (save === 'saving')
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      const response = json({ ...JSON.parse(String(init.body)), revision: 2 });
      response.headers.set('etag', '"story-2"');
      return response;
    }
    if (path === 'config')
      return json({
        name: 'Replays',
        sourceProviders: [],
        auth: 'none',
        editing: { enabled: true },
        beta: { editor: true, malleable: false, groupedInspector: true },
      });
    if (path === 'me') return json({ handles: [], linked: {} });
    if (path === 'capabilities')
      return json({
        credentials: {
          enabled: state !== 'unavailable',
          scopes: ['replays:read', 'conversations:read', 'conversations:write'],
          maxExpirySeconds: 2592000,
        },
      });
    if (path === 'agent-credentials')
      return json({
        credentials: credentials
          ? Array.from({ length: state === 'dense' ? 18 : 2 }, (_, i) => ({
              id: `fixture-${i}`,
              name: i ? 'CI reviewer with a very long project and environment name' : 'Local review',
              scopes: ['replays:read'],
              expiresAt: Date.now() + 86400000,
              revokedAt: i ? Date.now() : null,
            }))
          : [],
      });
    if (path === 'replays') {
      const filters: ReplayFilters = {};
      for (const key of ['q', 'host', 'tag'] as const) {
        const value = url.searchParams.get(key);
        if (value) filters[key] = value;
      }
      if (url.searchParams.get('errors') === 'true' || url.searchParams.get('errors') === '1') filters.errors = true;
      return json(state === 'empty' ? [] : librarySummaries.filter((summary) => matchesFilters(summary, filters)));
    }
    if (path === 'suites') return json(state === 'empty' ? [] : suites);
    if (/\/(poster|preview)$/.test(path)) return new Response(null, { status: 404 });
    if (path.endsWith('/edits')) return json({ version: 1, cuts: [], revision: 0 });
    if (path.startsWith('replays/')) {
      const id = decodeURIComponent(path.split('/')[1] ?? '');
      return json(
        state === 'empty'
          ? emptyReplay()
          : {
              ...(samples.find((item) => item.meta.id === id) ?? replay()),
              meta: { ...replay().meta, id },
            },
      );
    }
    return json({ error: `Unmocked story API: ${path}` }, 404);
  };
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
