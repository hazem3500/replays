import { CheckIcon, CircleCheckIcon, CircleIcon, LinkIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import type { PublicComment } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { Hint } from '@/components/icon-button.tsx';
import { formatRelative } from '../format.ts';
import { usePlayer } from '../player.ts';
import { Avatar } from './Avatar.tsx';
import type { CommentsApi, PlacedThread } from './CommentsProvider.tsx';
import { reportFailure } from './failure.ts';
import { ReplyBox } from './ReplyBox.tsx';
import { commentStrings } from './strings.ts';

/**
 * One written thread: the first comment with its moment (a click seeks there), resolve, the replies, and a quiet
 * Reply line that opens a box in place. Resolved threads stay listed, dimmed, with who resolved them.
 */
export function ThreadItem({ thread, comments, active }: { thread: PlacedThread; comments: CommentsApi; active: boolean }) {
  const { root, replies } = thread;
  const [replying, setReplying] = useState(false);
  const resolve = async () => {
    try {
      await comments.resolve(root.id, !root.resolved);
    } catch (error) {
      reportFailure(error);
    }
  };
  const resolveLabel = root.resolved ? 'Reopen thread' : 'Resolve thread';
  return (
    <li
      className="comment-thread"
      data-testid="comment-thread"
      data-thread-id={root.id}
      data-active={active || undefined}
      data-selected={comments.selectedId === root.id || undefined}
      data-resolved={root.resolved ? true : undefined}
      data-removed={thread.placement.state === 'removed' || undefined}
    >
      <CommentRow
        comment={root}
        comments={comments}
        lead={<ThreadLead thread={thread} comments={comments} />}
        tools={
          <IconAction label="Copy link to comment" onClick={() => comments.copyLink(thread)} testId="comment-copy-link">
            <LinkIcon aria-hidden="true" />
          </IconAction>
        }
        status={
          <Hint label={resolveLabel}>
            <button
              type="button"
              className="comment-resolve"
              aria-label={resolveLabel}
              aria-pressed={Boolean(root.resolved)}
              data-testid="comment-resolve"
              onClick={() => void resolve()}
            >
              {root.resolved ? <CircleCheckIcon aria-hidden="true" /> : <CircleIcon aria-hidden="true" />}
            </button>
          </Hint>
        }
      />
      {root.resolved ? (
        <p className="comment-resolved" data-testid="comment-resolved-note">
          <CheckIcon aria-hidden="true" /> Resolved by {root.resolved.by}
        </p>
      ) : null}
      {replies.length > 0 ? (
        <ol className="comment-replies">
          {replies.map((reply) => (
            <li key={reply.id} data-testid="comment-reply-item">
              <CommentRow comment={reply} comments={comments} />
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? (
        <ReplyBox comments={comments} parentId={root.id} onDone={() => setReplying(false)} />
      ) : (
        <button type="button" className="comment-reply-open" data-testid="comment-reply" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </li>
  );
}

function ThreadLead({ thread, comments }: { thread: PlacedThread; comments: CommentsApi }) {
  const player = usePlayer();
  const { root, placement } = thread;
  if (placement.state === 'visible')
    return (
      <button
        type="button"
        className="comment-time"
        data-testid="comment-time"
        onClick={() => {
          comments.reveal(root.id, { open: false });
          player.seek(placement.at);
        }}
        aria-label={`Go to ${formatClock(placement.at)}`}
      >
        {formatClock(placement.at)}
      </button>
    );
  if (placement.state === 'removed')
    return (
      <span className="comment-removed" data-testid="comment-removed">
        {commentStrings.removed} ·{' '}
        <a href={comments.originalHref(root)} className="comment-link">
          {commentStrings.viewOriginal}
        </a>
      </span>
    );
  return <span className="comment-whole">{commentStrings.wholeReplay}</span>;
}

function IconAction({ label, onClick, testId, children }: { label: string; onClick: () => void; testId: string; children: ReactNode }) {
  return (
    <Hint label={label}>
      <button type="button" className="comment-action" aria-label={label} data-testid={testId} onClick={onClick}>
        {children}
      </button>
    </Hint>
  );
}

/**
 * One comment (a thread's first, or a reply): who, its moment and when, the text, and what its author may do. The
 * author's tools show on hover or focus (always on touch); `status` (resolve) stays visible.
 */
function CommentRow({
  comment,
  comments,
  lead,
  tools,
  status,
}: {
  comment: PublicComment;
  comments: CommentsApi;
  lead?: ReactNode;
  tools?: ReactNode;
  status?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    try {
      await comments.remove(comment.id);
    } catch (error) {
      reportFailure(error);
    }
  };
  const author = comment.author;
  return (
    <div className="comment" data-testid="comment" data-comment-id={comment.id} data-mine={comment.mine || undefined}>
      <Avatar name={author.name} avatarUrl={author.avatarUrl} anonymous={Boolean(author.anonymous)} />
      <div className="comment-main">
        <div className="comment-head">
          <strong className="comment-author" data-testid="comment-author">
            {author.name}
          </strong>
          {lead}
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="comment-when">
            {formatRelative(comment.createdAt, undefined, 'narrow')}
          </time>
          {comment.editedAt ? <span className="comment-when">edited</span> : null}
          {editing ? null : (
            <span className="comment-tools">
              <span className="comment-actions">
                {tools}
                {comment.mine ? (
                  <IconAction label="Edit" onClick={() => setEditing(true)} testId="comment-edit">
                    <PencilIcon aria-hidden="true" />
                  </IconAction>
                ) : null}
                {comment.mine ? (
                  <IconAction label="Delete" onClick={() => setConfirming(true)} testId="comment-delete">
                    <Trash2Icon aria-hidden="true" />
                  </IconAction>
                ) : null}
              </span>
              {status}
            </span>
          )}
        </div>
        {editing ? (
          <ReplyBox comments={comments} editing={comment} onDone={() => setEditing(false)} />
        ) : (
          <p className="comment-body" data-testid="comment-body">
            {comment.body}
          </p>
        )}
        {confirming ? (
          <div className="comment-confirm" role="group" aria-label="Delete this comment?">
            <span>{comment.parentId ? 'Delete this reply?' : 'Delete this comment and its replies?'}</span>
            <button
              type="button"
              className="comment-link comment-danger"
              data-testid="comment-delete-confirm"
              onClick={() => void remove()}
            >
              Delete
            </button>
            <button type="button" className="comment-link" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
