// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CommentsResponse, PublicComment } from '../src/shared/comments.ts';
import { type CommentRows, useCommentRows } from '../src/client/data/comments.ts';

const me = { name: 'Ada', anonymous: false };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const comment = (id: string, extra: Partial<PublicComment> = {}): PublicComment => ({
  id,
  body: 'Saved',
  author: { name: 'Ada' },
  createdAt: '2026-10-27T12:00:00.000Z',
  mine: true,
  ...extra,
});

/** The comments API as a process boundary: GET lists `initial`; each write takes the next queued answer. */
function serve(initial: PublicComment[]) {
  const answers: Response[] = [];
  const list: CommentsResponse = { comments: initial, me, anonymous: false };
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(!init?.method || init.method === 'GET' ? json(list) : (answers.shift() ?? json({ error: 'unexpected' }, 500))),
    ),
  );
  return (body: unknown, status = 200) => answers.push(json(body, status));
}

function Probe({ onRows }: { onRows: (rows: CommentRows) => void }) {
  onRows(useCommentRows('demo'));
  return null;
}

/** Mounts `useCommentRows('demo')` and hands back its latest result. */
async function mount(initial: PublicComment[]) {
  const answer = serve(initial);
  const latest: { rows?: CommentRows } = {};
  const onRows = (rows: CommentRows) => {
    latest.rows = rows;
  };
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe, { onRows })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const rows = () => {
    if (!latest.rows) throw new Error('the probe did not render');
    return latest.rows;
  };
  return { answer, rows, ids: () => rows().comments.map((row) => row.id) };
}

describe('optimistic comments', () => {
  beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => vi.unstubAllGlobals());

  it('shows a new comment as a draft on the frame it is posted', async () => {
    const view = await mount([]);
    view.answer(comment('c-server1', { body: 'Hello' }));
    let sending = Promise.resolve(comment('none'));
    act(() => {
      sending = view.rows().create({ body: ' Hello ' });
    });
    expect(view.rows().comments).toMatchObject([{ body: 'Hello', mine: true, author: { name: 'Ada' } }]);
    await act(async () => void (await sending));
  });

  it('replaces the draft with the server’s row once it is saved', async () => {
    const view = await mount([]);
    view.answer(comment('c-server1', { body: 'Hello' }));
    await act(async () => void (await view.rows().create({ body: 'Hello' })));
    expect(view.ids()).toEqual(['c-server1']);
  });

  it('rolls a refused comment back and rejects with the server’s reason', async () => {
    const view = await mount([comment('c-first1')]);
    view.answer({ error: 'Slow down' }, 429);
    await act(async () => {
      await expect(view.rows().create({ body: 'Too fast' })).rejects.toThrow('Slow down');
    });
    expect(view.ids()).toEqual(['c-first1']);
  });

  it('shows an edit in place', async () => {
    const view = await mount([comment('c-root01')]);
    view.answer(comment('c-root01', { body: 'Edited', editedAt: '2026-10-27T12:01:00.000Z' }));
    await act(async () => void (await view.rows().edit('c-root01', 'Edited')));
    expect(view.rows().comments[0]).toMatchObject({ body: 'Edited', editedAt: '2026-10-27T12:01:00.000Z' });
  });

  it('drops a reopened thread’s resolved note when the server’s row lands without one', async () => {
    const view = await mount([comment('c-root01', { resolved: { by: 'Ada', at: 'then' } })]);
    view.answer(comment('c-root01'));
    await act(async () => void (await view.rows().resolve('c-root01', false)));
    expect(view.rows().comments[0]?.resolved).toBeUndefined();
  });

  it('deletes a thread with its replies', async () => {
    const view = await mount([comment('c-root01'), comment('c-reply1', { parentId: 'c-root01' }), comment('c-other1')]);
    view.answer({ removed: 2 });
    await act(() => view.rows().remove('c-root01'));
    expect(view.ids()).toEqual(['c-other1']);
  });

  it('puts a thread back when deleting it is refused', async () => {
    const view = await mount([comment('c-root01')]);
    view.answer({ error: 'Only the author can delete this comment' }, 403);
    await act(async () => {
      await expect(view.rows().remove('c-root01')).rejects.toThrow('Only the author');
    });
    expect(view.ids()).toEqual(['c-root01']);
  });

  it('reads who is commenting from the response', async () => {
    const view = await mount([]);
    expect(view.rows().me).toEqual(me);
  });
});
