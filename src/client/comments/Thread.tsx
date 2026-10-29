import { type ReactNode, useState } from 'react';

import type { PublicComment } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { useCanHover } from '@/components/ui/tooltip.tsx';
import { formatRelative } from '../format.ts';
import { usePlayer } from '../player.ts';
import { Avatar } from './Avatar.tsx';
import { ActionSheet, type CommentActionSet, DeleteDialog, HoverActions } from './CommentActions.tsx';
import type { CommentsApi, PlacedThread } from './CommentsProvider.tsx';
import { reportFailure } from './failure.ts';
import { ReplyBox } from './ReplyBox.tsx';
import { commentStrings } from './strings.ts';

/**
 * One written thread in the flowing list: the first comment, its replies indented under it, and a reply box in place
 * when asked. Resolved threads stay listed, dimmed, with who resolved them.
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
        lead={<ThreadTime thread={thread} comments={comments} />}
        thread={{ onReply: () => setReplying(true), onResolve: () => void resolve(), resolved: Boolean(root.resolved) }}
        replies={replies.length}
        onCopyLink={() => comments.copyLink(thread)}
      />
      {root.resolved ? (
        <p className="comment-resolved" data-testid="comment-resolved-note">
          {commentStrings.resolvedBy(root.resolved.by)}
        </p>
      ) : null}
      {replies.length > 0 ? (
        <ol className="comment-replies">
          {replies.map((reply) => (
            <li key={reply.id} data-testid="comment-reply-item">
              <CommentRow comment={reply} comments={comments} onCopyLink={() => comments.copyLink(thread)} />
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? <ReplyBox comments={comments} parentId={root.id} onDone={() => setReplying(false)} /> : null}
    </li>
  );
}

/** The thread's moment as an understated link that seeks there; "Whole replay", or a pointer to the original when cut. */
function ThreadTime({ thread, comments }: { thread: PlacedThread; comments: CommentsApi }) {
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
        aria-label={commentStrings.goTo(formatClock(placement.at))}
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

/**
 * One comment, a thread's first or a reply: avatar, one quiet line (who, when in the replay, how long ago) and the
 * text. Its actions follow the device: hover-revealed on a desktop, a tap on the comment opens a sheet on a phone.
 */
function CommentRow({
  comment,
  comments,
  lead,
  thread,
  replies = 0,
  onCopyLink,
}: {
  comment: PublicComment;
  comments: CommentsApi;
  lead?: ReactNode;
  thread?: Pick<CommentActionSet, 'onReply' | 'onResolve' | 'resolved'>;
  replies?: number;
  onCopyLink: () => void;
}) {
  const canHover = useCanHover();
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    setConfirming(false);
    try {
      await comments.remove(comment.id);
    } catch (error) {
      reportFailure(error);
    }
  };
  const author = comment.author;
  const actions: CommentActionSet = {
    ...thread,
    onCopyLink,
    onEdit: comment.mine ? () => setEditing(true) : undefined,
    onDelete: comment.mine ? () => setConfirming(true) : undefined,
  };
  return (
    <div className="comment" data-testid="comment" data-comment-id={comment.id} data-mine={comment.mine || undefined}>
      {canHover || editing ? null : (
        <button
          type="button"
          className="comment-tap"
          aria-label={commentStrings.tapForActions(author.name)}
          aria-haspopup="dialog"
          data-testid="comment-tap"
          onClick={() => setSheet(true)}
        />
      )}
      <Avatar name={author.name} avatarUrl={author.avatarUrl} anonymous={Boolean(author.anonymous)} />
      <div className="comment-main">
        <div className="comment-meta">
          <span className="comment-author" data-testid="comment-author">
            {author.name}
          </span>
          {lead}
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="comment-when">
            {formatRelative(comment.createdAt, undefined, 'narrow')}
          </time>
          {comment.editedAt ? <span className="comment-when">{commentStrings.edited}</span> : null}
          {canHover && !editing ? <HoverActions actions={actions} /> : null}
        </div>
        {editing ? (
          <ReplyBox comments={comments} editing={comment} onDone={() => setEditing(false)} />
        ) : (
          <p className="comment-body" data-testid="comment-body">
            {comment.body}
          </p>
        )}
      </div>
      {canHover ? null : <ActionSheet open={sheet} onOpenChange={setSheet} title={comment.body} actions={actions} />}
      <DeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        reply={Boolean(comment.parentId)}
        replies={replies}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
