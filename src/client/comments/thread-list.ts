import type { CommentThread } from '../../shared/comments.ts';

/** Which threads the panel lists. Reactions are never resolved, so they show under Open and All. */
export type ThreadFilter = 'all' | 'open' | 'resolved';

/** One row of the panel: a written thread, or a run of reactions that sit next to each other in time. */
export type ListItem<T extends CommentThread> = { kind: 'thread'; thread: T } | { kind: 'reactions'; threads: T[] };

const isReaction = (thread: CommentThread) => Boolean(thread.root.emoji);

/** Written threads (reactions are not counted), open and resolved. */
export function threadCounts(threads: readonly CommentThread[]) {
  const written = threads.filter((thread) => !isReaction(thread));
  const resolved = written.filter((thread) => thread.root.resolved).length;
  return { all: written.length, open: written.length - resolved, resolved };
}

/**
 * The panel's rows for `filter`, in the threads' own order. Consecutive reactions fold into one row, so a burst of
 * emoji reads as one quiet line instead of a stack of one-glyph threads.
 */
export function listItems<T extends CommentThread>(threads: readonly T[], filter: ThreadFilter): ListItem<T>[] {
  const items: ListItem<T>[] = [];
  for (const thread of threads) {
    if (filter === 'open' && thread.root.resolved) continue;
    if (filter === 'resolved' && !thread.root.resolved) continue;
    const last = items.at(-1);
    if (!isReaction(thread)) items.push({ kind: 'thread', thread });
    else if (last?.kind === 'reactions') last.threads.push(thread);
    else items.push({ kind: 'reactions', threads: [thread] });
  }
  return items;
}

/** The filter in effect: without resolved threads there is nothing to switch between, so everything shows. */
export function effectiveFilter(filter: ThreadFilter, counts: ReturnType<typeof threadCounts>): ThreadFilter {
  return counts.resolved === 0 ? 'all' : filter;
}
