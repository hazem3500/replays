import { describe, expect, it } from 'vitest';

import { demoComments } from '../scripts/demo-comments.mjs';
import { CommentsStore } from '../src/server/comments-store.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { threadsOf } from '../src/shared/comments.ts';

const ids = (index: number) => demoComments(10_000, 0, index).comments.map((comment) => comment.id);

describe('demo comments', () => {
  it('are a comments file the comment store reads back whole', async () => {
    const storage = new MemoryStorage();
    const file = demoComments(10_000, Date.parse('2026-10-28T12:00:00Z'));
    await storage.write('demo-replay/comments.json', JSON.stringify(file));
    await expect(new CommentsStore(storage).list('demo-replay')).resolves.toHaveLength(file.comments.length);
  });

  it('cover the populated states: a whole-replay note, replies, a resolved thread and reactions inside the replay', () => {
    const { comments } = demoComments(10_000);
    const threads = threadsOf(comments.map((comment) => ({ ...comment, author: { name: comment.author.name ?? '' }, mine: false })));
    expect(threads.some((thread) => thread.root.at === undefined)).toBe(true);
    expect(threads.some((thread) => thread.replies.length > 1)).toBe(true);
    expect(threads.some((thread) => thread.root.resolved)).toBe(true);
    expect(comments.filter((comment) => comment.emoji).length).toBeGreaterThan(1);
    expect(comments.every((comment) => comment.at === undefined || (comment.at >= 0 && comment.at <= 10_000))).toBe(true);
  });

  it('give each replay its own comment ids', () => {
    expect(ids(0).some((id) => ids(1).includes(id))).toBe(false);
  });
});
