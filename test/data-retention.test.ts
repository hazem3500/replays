// @vitest-environment happy-dom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySummary } from '../src/shared/replay.ts';
import type { Retention } from '../src/shared/retention.ts';
import { retentionCollection, retentionKey, setKept } from '../src/client/data/retention.ts';
import { indexReplaysQuery } from '../src/client/index/index-queries.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const keptByAda: Retention = { kept: { by: 'ada@example.com', at: '2026-10-27T13:00:00.000Z' }, expiresAt: null };
const expiring: Retention = { expiresAt: '2026-11-20T00:00:00.000Z' };
const summary: ReplaySummary = {
  id: 'demo',
  title: 'Demo',
  url: 'https://shop.example/',
  host: 'shop.example',
  capturedAt: '2026-10-27T12:00:00.000Z',
  duration: 1000,
  steps: 1,
  consoleErrors: 0,
  failedRequests: 0,
  source: 'agent',
  expiresAt: '2026-11-20T00:00:00.000Z',
};

/** The keep API as a process boundary: one answer per method. */
function serve(answers: Partial<Record<'GET' | 'PUT' | 'DELETE', Response>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const answer = method === 'GET' || method === 'PUT' || method === 'DELETE' ? answers[method] : undefined;
      return Promise.resolve(answer?.clone() ?? json({ error: 'unexpected' }, 500));
    }),
  );
}

async function loaded(retention: Retention) {
  const client = new QueryClient();
  const rows = retentionCollection(client, 'replay', 'demo');
  serve({ GET: json(retention) });
  await rows.preload();
  return { client, rows };
}

describe('optimistic keep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows Keep on the frame it is pressed', async () => {
    const { client, rows } = await loaded(expiring);
    serve({ PUT: json(keptByAda) });
    const keeping = setKept(client, { kind: 'replay', id: 'demo', keep: true });
    expect(rows.get('demo')).toMatchObject({ kept: { by: 'you' }, expiresAt: null });
    await keeping;
  });

  it('lands the server’s keep record', async () => {
    const { client, rows } = await loaded(expiring);
    serve({ PUT: json(keptByAda) });
    await setKept(client, { kind: 'replay', id: 'demo', keep: true });
    expect(rows.get('demo')?.kept?.by).toBe('ada@example.com');
  });

  it('patches the index lists, so Back shows the new state without a refetch', async () => {
    const { client } = await loaded(expiring);
    client.setQueryData(indexReplaysQuery('').queryKey, [summary]);
    serve({ PUT: json(keptByAda) });
    await setKept(client, { kind: 'replay', id: 'demo', keep: true });
    expect(client.getQueryData(indexReplaysQuery('').queryKey)?.at(0)).toMatchObject({
      kept: { by: 'ada@example.com' },
      expiresAt: null,
    });
  });

  it('updates the cached retention the Replay details row reads', async () => {
    const { client } = await loaded(expiring);
    serve({ PUT: json(keptByAda) });
    await setKept(client, { kind: 'replay', id: 'demo', keep: true });
    expect(client.getQueryData(retentionKey('replay', 'demo'))).toEqual(keptByAda);
  });

  it('rolls a refused release back', async () => {
    const { client, rows } = await loaded(keptByAda);
    serve({ DELETE: json({ error: 'nope' }, 500) });
    await expect(setKept(client, { kind: 'replay', id: 'demo', keep: false })).rejects.toThrow('Retention failed');
    expect(rows.get('demo')?.kept?.by).toBe('ada@example.com');
  });

  it('lands a release whole, so the old keep record does not linger', async () => {
    const { client, rows } = await loaded(keptByAda);
    serve({ DELETE: json(expiring) });
    await setKept(client, { kind: 'replay', id: 'demo', keep: false });
    expect(rows.get('demo')).toMatchObject({ expiresAt: '2026-11-20T00:00:00.000Z' });
    expect(rows.get('demo')?.kept).toBeUndefined();
  });
});
