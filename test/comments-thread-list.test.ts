import { describe, expect, it } from 'vitest';

import { effectiveFilter, listItems, threadCounts } from '../src/client/comments/thread-list.ts';
import { type PublicComment, threadsOf } from '../src/shared/comments.ts';

let next = 0;
function comment(fields: Partial<PublicComment>): PublicComment {
  next += 1;
  return {
    id: `c-test${String(next).padStart(4, '0')}`,
    body: '',
    author: { name: 'Ada' },
    createdAt: `2026-10-28T10:00:${String(next).padStart(2, '0')}Z`,
    mine: false,
    ...fields,
  };
}

const resolved = { by: 'Bob', at: '2026-10-28T11:00:00Z' };
const threads = threadsOf([
  comment({ body: 'whole replay note' }),
  comment({ body: 'open at 1 s', at: 1000 }),
  comment({ emoji: '🎉', at: 2000 }),
  comment({ emoji: '👀', at: 2500 }),
  comment({ body: 'resolved at 3 s', at: 3000, resolved }),
  comment({ emoji: '🐛', at: 4000 }),
]);

const shape = (filter: Parameters<typeof listItems>[1]) =>
  listItems(threads, filter).map((item) =>
    item.kind === 'thread' ? item.thread.root.body : item.threads.map((thread) => thread.root.emoji).join(''),
  );

describe('comment list rows', () => {
  it('folds reactions that sit next to each other into one row and keeps time order', () => {
    expect(shape('all')).toEqual(['whole replay note', 'open at 1 s', '🎉👀', 'resolved at 3 s', '🐛']);
  });

  it('joins reactions that a filtered-out thread separated', () => {
    expect(shape('open')).toEqual(['whole replay note', 'open at 1 s', '🎉👀🐛']);
  });

  it('lists only resolved threads under Resolved, without reactions', () => {
    expect(shape('resolved')).toEqual(['resolved at 3 s']);
  });

  it('counts written threads only, split into open and resolved', () => {
    expect(threadCounts(threads)).toEqual({ all: 3, open: 2, resolved: 1 });
  });

  it('falls back to every thread once nothing is resolved, so a stale Resolved filter cannot empty the list', () => {
    expect(effectiveFilter('resolved', { all: 2, open: 2, resolved: 0 })).toBe('all');
    expect(effectiveFilter('resolved', { all: 2, open: 1, resolved: 1 })).toBe('resolved');
  });
});
