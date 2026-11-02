// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CommentsResponse, PublicComment } from '../src/shared/comments.ts';
import { type CommentDrafts, commentState, useCommentDrafts } from '../src/client/data/comment-drafts.ts';
import { useCommentRows } from '../src/client/data/comments.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const saved: PublicComment = { id: 'c-server1', body: 'Hello', author: { name: 'Ada' }, createdAt: '2026-10-27T12:00:00.000Z', mine: true };

/** The comments API as a process boundary: GET lists nothing; each write takes the next queued answer. */
function serve() {
  const answers: Response[] = [];
  const list: CommentsResponse = { comments: [], me: { name: 'Ada', anonymous: false }, anonymous: false };
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(!init?.method || init.method === 'GET' ? json(list) : (answers.shift() ?? json({ error: 'unexpected' }, 500))),
    ),
  );
  return (body: unknown, status = 200) => answers.push(json(body, status));
}

function Probe({ onDrafts }: { onDrafts: (drafts: CommentDrafts) => void }) {
  onDrafts(useCommentDrafts('demo', useCommentRows('demo')));
  return null;
}

async function mount() {
  const answer = serve();
  const latest: { drafts?: CommentDrafts } = {};
  const onDrafts = (drafts: CommentDrafts) => {
    latest.drafts = drafts;
  };
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe, { onDrafts })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const drafts = () => {
    if (!latest.drafts) throw new Error('the probe did not render');
    return latest.drafts;
  };
  return { answer, drafts };
}

async function refused() {
  const view = await mount();
  view.answer({ error: 'Slow down' }, 429);
  await act(async () => {
    await view
      .drafts()
      .create({ body: 'Hello' })
      .catch(() => {});
  });
  return view;
}

describe('refused comments', () => {
  beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => vi.unstubAllGlobals());

  it('keep their text on screen as “Not sent”', async () => {
    const view = await refused();
    expect(view.drafts().comments.map((comment) => [comment.body, commentState(comment)])).toEqual([['Hello', 'failed']]);
  });

  it('reject with the server’s reason', async () => {
    const view = await mount();
    view.answer({ error: 'Slow down' }, 429);
    await act(async () => {
      await expect(view.drafts().create({ body: 'Hello' })).rejects.toThrow('Slow down');
    });
  });

  it('go through on Retry and leave only the server’s row', async () => {
    const view = await refused();
    view.answer(saved);
    const [row] = view.drafts().comments;
    await act(async () => void (await view.drafts().resend(row?.id ?? '')));
    expect(view.drafts().comments.map((comment) => [comment.id, commentState(comment)])).toEqual([['c-server1', 'sent']]);
  });

  it('are gone after Discard', async () => {
    const view = await refused();
    const [row] = view.drafts().comments;
    act(() => view.drafts().discard(row?.id ?? ''));
    expect(view.drafts().comments).toEqual([]);
  });
});
