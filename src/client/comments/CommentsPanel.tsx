import { MessageSquareIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { activeThread } from '../../shared/comments.ts';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useThreadFollow } from '../hooks/use-thread-follow.ts';
import { usePlayhead } from '../player.ts';
import { Composer } from './Composer.tsx';
import { type CommentsApi, useComments } from './CommentsProvider.tsx';
import { ReactionRow } from './Reactions.tsx';
import { commentStrings } from './strings.ts';
import { ThreadItem } from './Thread.tsx';
import { effectiveFilter, listItems, threadCounts, type ThreadFilter } from './thread-list.ts';
import './comments.css';

/**
 * The Comments tab of the open replay (in compare mode, of the focused recording: a new recording starts a fresh
 * panel, draft and filter included).
 */
export function CommentsPanel() {
  const comments = useComments();
  if (!comments) return null;
  return <CommentsPanelView key={comments.replayId} comments={comments} />;
}

/**
 * The threads in time order with the composer docked below them. The thread at the playhead (or the next one ahead)
 * is highlighted and kept in view while the replay plays; once something is resolved, a filter switches between open
 * and resolved threads. Threads edited out of the replay stay listed, marked "in removed section".
 */
export function CommentsPanelView({ comments }: { comments: CommentsApi }) {
  const list = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const { threads, pins, selectedId } = comments;
  const activeId = usePlayhead((time) =>
    activeThread(
      pins.map((pin) => ({ id: pin.thread.root.id, at: pin.at })),
      time,
    ),
  );
  useThreadFollow(list, activeId, selectedId);
  const counts = threadCounts(threads);
  const shown = effectiveFilter(filter, counts);
  const items = listItems(threads, shown);

  return (
    <div className="comments" data-testid="comments-panel">
      {counts.resolved > 0 ? <FilterBar filter={shown} counts={counts} onFilter={setFilter} /> : null}
      <div ref={list} className="table-scroll comments-scroll">
        {comments.error && !comments.loaded ? (
          <EmptyState
            variant="compact"
            tone="error"
            title={commentStrings.failedTitle}
            body={comments.error}
            actions={[{ id: 'retry', label: commentStrings.retry, primary: true, onSelect: comments.retry }]}
            testId="comments-error"
          />
        ) : !comments.loaded ? (
          <p className="comments-loading" role="status">
            {commentStrings.loading}
          </p>
        ) : threads.length === 0 ? (
          <CommentsEmpty />
        ) : items.length === 0 ? (
          <p className="comments-filtered-empty">{commentStrings.filteredEmpty[shown]}</p>
        ) : (
          <ol className="comment-list" data-testid="comment-list">
            {items.map((item) =>
              item.kind === 'thread' ? (
                <ThreadItem key={item.thread.root.id} thread={item.thread} comments={comments} active={item.thread.root.id === activeId} />
              ) : (
                <ReactionRow key={item.threads[0]!.root.id} threads={item.threads} comments={comments} activeId={activeId} />
              ),
            )}
          </ol>
        )}
      </div>
      <Composer comments={comments} />
    </div>
  );
}

const FILTERS: Array<{ id: ThreadFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
];

function FilterBar({
  filter,
  counts,
  onFilter,
}: {
  filter: ThreadFilter;
  counts: ReturnType<typeof threadCounts>;
  onFilter: (filter: ThreadFilter) => void;
}) {
  return (
    <div className="comments-filter" role="group" aria-label="Show comments" data-testid="comments-filter">
      {FILTERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className="comments-filter-option"
          aria-pressed={filter === id}
          data-testid={`comments-filter-${id}`}
          onClick={() => onFilter(id)}
        >
          {label}
          <span className="comments-filter-count">{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}

/** Nothing written yet: one calm line that points at the composer below and, with a keyboard, at `M`. */
function CommentsEmpty() {
  return (
    <div className="comments-empty" data-testid="comments-empty">
      <span className="comments-empty-icon" aria-hidden="true">
        <MessageSquareIcon />
      </span>
      <p className="comments-empty-title">{commentStrings.emptyTitle}</p>
      <p className="comments-empty-body comments-empty-keyboard">
        Press <Kbd>M</Kbd> {commentStrings.emptyKeyboard}
      </p>
      <p className="comments-empty-body comments-empty-touch">{commentStrings.emptyTouch}</p>
    </div>
  );
}
