import { toast } from 'sonner';

import type { PublicComment } from '../../shared/comments.ts';
import { CommentNotSentError } from '../data/comment-drafts.ts';
import { formatRelative } from '../format.ts';
import type { CommentsApi } from './CommentsProvider.tsx';

/** A refused post: says so, and offers to send it again (its text stays in its "Not sent" row either way). */
export function notSent(error: unknown, comments: CommentsApi) {
  if (!(error instanceof CommentNotSentError)) return;
  toast.error('Couldn’t post comment', {
    duration: 6000,
    description: error.message,
    action: { label: 'Retry', onClick: () => void comments.resend(error.failedId).catch((next: unknown) => notSent(next, comments)) },
  });
}

/** When a comment was written; "Sending…" while it is on its way, and "Not sent · Retry · Discard" when refused. */
export function CommentWhen({ comment, comments }: { comment: PublicComment; comments: CommentsApi }) {
  const state = comments.stateOf(comment);
  if (state === 'sending')
    return (
      <span className="comment-when" data-testid="comment-sending">
        Sending…
      </span>
    );
  if (state === 'failed')
    return (
      <span className="comment-when comment-not-sent" role="group" aria-label="Not sent" data-testid="comment-not-sent">
        <span className="comment-danger">Not sent</span>
        {' · '}
        <button
          type="button"
          className="comment-link"
          data-testid="comment-resend"
          onClick={() => void comments.resend(comment.id).catch((error: unknown) => notSent(error, comments))}
        >
          Retry
        </button>
        {' · '}
        <button type="button" className="comment-link" data-testid="comment-discard" onClick={() => comments.discard(comment.id)}>
          Discard
        </button>
      </span>
    );
  return (
    <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="comment-when">
      {formatRelative(comment.createdAt, undefined, 'narrow')}
    </time>
  );
}
