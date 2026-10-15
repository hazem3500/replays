import { CheckIcon, LinkIcon, MapPinIcon, PencilIcon, ReplyIcon, RotateCcwIcon, SendIcon, SmilePlusIcon, Trash2Icon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { activeThread, MAX_COMMENT_BODY, type PublicComment, REACTION_EMOJI } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { Button } from '@/components/ui/button.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { formatRelative } from '../format.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { notify } from '../toast.ts';
import { Empty } from '../viewer/Empty.tsx';
import { Avatar } from './Avatar.tsx';
import { type CommentsApi, type PlacedThread, useComments } from './CommentsProvider.tsx';
import './comments.css';

/** A refused or failed write, told plainly (the server's reason when it gave one: rate limit, permission, limits). */
function fail(error: unknown) {
  notify(error instanceof Error ? error.message : 'Could not save the comment', 'error');
}

/**
 * The Comments tab: a composer pinned to the playhead (or the whole replay), reaction buttons, and every thread in
 * time order. The thread at the playhead (or the next one ahead of it) is highlighted and kept in view while the replay
 * plays; threads edited out of the replay stay listed, marked "in removed section".
 */
export function CommentsPanel() {
  const comments = useComments();
  if (!comments) return null;
  return <PanelBody comments={comments} />;
}

function PanelBody({ comments }: { comments: CommentsApi }) {
  const player = usePlayer();
  const list = useRef<HTMLDivElement>(null);
  const { threads, pins, selectedId } = comments;
  const activeId = usePlayhead((time) =>
    activeThread(
      pins.map((pin) => ({ id: pin.thread.root.id, at: pin.at })),
      time,
    ),
  );

  // Follow the playhead: the highlighted thread stays in view while nothing else is selected or being typed in.
  const followed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeId || followed.current === activeId) return;
    followed.current = activeId;
    // Not while someone is typing in the panel.
    if (list.current?.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA') return;
    scrollToThread(list.current, activeId);
  }, [activeId]);
  // A selected thread (marker click, permalink, new comment) scrolls into view, too.
  useLayoutEffect(() => {
    if (selectedId) scrollToThread(list.current, selectedId);
  }, [selectedId]);

  const react = async (emoji: string) => {
    try {
      await comments.create({ emoji, at: comments.sourceTime(player.getTime()) });
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div ref={list} className="table-scroll comments" data-testid="comments-panel">
      <div className="comments-inner">
        {comments.anonymous ? (
          <p className="comments-notice" data-testid="comments-anonymous-notice" role="note">
            <strong>Anonymous.</strong> Sign-in is off on this server, so comments are posted as “Anonymous” and anyone with access can edit
            or delete them.
          </p>
        ) : null}
        <Composer comments={comments} />
        <div className="comments-react" role="group" aria-label="React at the playhead">
          <span className="comments-react-label">
            <SmilePlusIcon aria-hidden="true" /> React at the playhead
          </span>
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="comments-react-button"
              data-testid="react"
              aria-label={`React ${emoji}`}
              onClick={() => void react(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        {comments.error && !comments.loaded ? (
          <Empty title="Comments didn’t load">{comments.error}</Empty>
        ) : !comments.loaded ? (
          <p className="comments-loading">Loading comments…</p>
        ) : threads.length === 0 ? (
          <Empty title="No comments yet">Press M to comment at the current time, or write one for the whole replay.</Empty>
        ) : (
          <ol className="comment-list" data-testid="comment-list">
            {threads.map((thread) => (
              <ThreadItem key={thread.root.id} thread={thread} comments={comments} active={thread.root.id === activeId} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function scrollToThread(container: HTMLElement | null, id: string) {
  const item = container?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`);
  if (!item || !container) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = item.offsetTop - container.offsetTop;
  if (top < container.scrollTop || top + item.offsetHeight > container.scrollTop + container.clientHeight)
    container.scrollTo({ top: Math.max(0, top - 8), behavior: reduce ? 'auto' : 'smooth' });
}

/* ---------- Composer ---------- */

function Composer({ comments }: { comments: CommentsApi }) {
  const player = usePlayer();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(true);
  const [pinAt, setPinAt] = useState(() => player.getTime());
  const [pending, setPending] = useState(false);
  const id = useId();
  const { composerRequest, consumeComposerRequest } = comments;

  // `M`: pin the moment the request was made (adjusted during render, once per request) and put the cursor in the box.
  const [handled, setHandled] = useState<number>();
  if (composerRequest && composerRequest.id !== handled) {
    setHandled(composerRequest.id);
    setPinned(true);
    setPinAt(composerRequest.at);
  }
  useEffect(() => {
    if (!composerRequest) return;
    consumeComposerRequest();
    // At once when the panel is already up; else (it has only just mounted) once it has painted.
    if (field.current) field.current.focus();
    else requestAnimationFrame(() => field.current?.focus());
  }, [composerRequest, consumeComposerRequest]);

  const submit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      const saved = await comments.create({
        body: text,
        ...(pinned ? { at: comments.sourceTime(pinAt) } : {}),
      });
      setText('');
      comments.select(saved.id);
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  return (
    <div className="comment-composer" data-testid="comment-composer">
      <div className="comment-composer-who">
        <Avatar name={comments.me?.name ?? ''} avatarUrl={comments.me?.avatarUrl} anonymous={comments.anonymous} />
        <label htmlFor={id} className="comment-composer-name">
          {comments.me?.name ?? '…'}
        </label>
      </div>
      <textarea
        ref={field}
        id={id}
        className="comment-input"
        data-testid="comment-input"
        rows={2}
        maxLength={MAX_COMMENT_BODY}
        placeholder={pinned ? `Comment at ${formatClock(pinAt)}…` : 'Comment on the whole replay…'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => {
          // An untouched box follows the playhead to where the person is looking when they start.
          if (!text) setPinAt(player.getTime());
        }}
        onKeyDown={onKeyDown}
      />
      <div className="comment-composer-row">
        <Hint label={pinned ? 'Pinned to this moment. Click to comment on the whole replay' : 'Click to pin to the current time'}>
          <button
            type="button"
            className="comment-pin"
            data-testid="comment-pin"
            aria-pressed={pinned}
            onClick={() => {
              if (!pinned) setPinAt(player.getTime());
              setPinned(!pinned);
            }}
          >
            <MapPinIcon aria-hidden="true" />
            {pinned ? formatClock(pinAt) : 'Whole replay'}
          </button>
        </Hint>
        {pinned ? (
          <button type="button" className="comment-link" onClick={() => setPinAt(player.getTime())}>
            Use current time
          </button>
        ) : null}
        <span className="comment-composer-spacer" />
        {text.length > MAX_COMMENT_BODY - 200 ? (
          <span className="comment-count" aria-live="polite">
            {MAX_COMMENT_BODY - text.length}
          </span>
        ) : null}
        <Button size="sm" disabled={!text.trim() || pending} onClick={() => void submit()} data-testid="comment-submit">
          <SendIcon aria-hidden="true" />
          Comment
        </Button>
      </div>
    </div>
  );
}

/* ---------- Threads ---------- */

function ThreadItem({ thread, comments, active }: { thread: PlacedThread; comments: CommentsApi; active: boolean }) {
  const player = usePlayer();
  const { root, replies, placement } = thread;
  const [replying, setReplying] = useState(false);
  const removed = placement.state === 'removed';
  const resolve = async () => {
    try {
      await comments.resolve(root.id, !root.resolved);
    } catch (error) {
      fail(error);
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
      data-removed={removed || undefined}
    >
      <CommentRow
        comment={root}
        comments={comments}
        lead={
          placement.state === 'visible' ? (
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
          ) : removed ? (
            <span className="comment-removed" data-testid="comment-removed">
              In removed section ·{' '}
              <a href={comments.originalHref(root)} className="comment-link">
                View in original
              </a>
            </span>
          ) : (
            <span className="comment-whole">Whole replay</span>
          )
        }
        actions={
          <>
            {root.emoji ? null : (
              <IconAction label="Reply" onClick={() => setReplying(true)} testId="comment-reply">
                <ReplyIcon aria-hidden="true" />
              </IconAction>
            )}
            {root.emoji ? null : (
              <IconAction
                label={root.resolved ? 'Reopen thread' : 'Resolve thread'}
                onClick={() => void resolve()}
                testId="comment-resolve"
              >
                {root.resolved ? <RotateCcwIcon aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
              </IconAction>
            )}
            <IconAction label="Copy link to comment" onClick={() => comments.copyLink(thread)} testId="comment-copy-link">
              <LinkIcon aria-hidden="true" />
            </IconAction>
          </>
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
      {replying ? <ReplyBox comments={comments} parentId={root.id} onDone={() => setReplying(false)} /> : null}
    </li>
  );
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

/** One comment (a thread's first or a reply): who and when, its text (or reaction), and what its author may do. */
function CommentRow({
  comment,
  comments,
  lead,
  actions,
}: {
  comment: PublicComment;
  comments: CommentsApi;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    try {
      await comments.remove(comment.id);
    } catch (error) {
      fail(error);
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
          {comment.editedAt ? <span className="comment-when">· edited</span> : null}
        </div>
        {editing ? (
          <ReplyBox comments={comments} editing={comment} onDone={() => setEditing(false)} />
        ) : comment.emoji ? (
          <p className="comment-body comment-reaction" data-testid="comment-reaction">
            {comment.emoji}
          </p>
        ) : (
          <p className="comment-body" data-testid="comment-body">
            {comment.body}
          </p>
        )}
        {editing ? null : (
          <div className="comment-actions">
            {actions}
            {comment.mine && !comment.emoji ? (
              <IconAction label="Edit" onClick={() => setEditing(true)} testId="comment-edit">
                <PencilIcon aria-hidden="true" />
              </IconAction>
            ) : null}
            {comment.mine ? (
              confirming ? (
                <span className="comment-confirm" role="group" aria-label="Delete this comment?">
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
                </span>
              ) : (
                <IconAction label="Delete" onClick={() => setConfirming(true)} testId="comment-delete">
                  <Trash2Icon aria-hidden="true" />
                </IconAction>
              )
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** A reply box under a thread, or the edit box of an existing comment. */
function ReplyBox({
  comments,
  parentId,
  editing,
  onDone,
}: {
  comments: CommentsApi;
  parentId?: string;
  editing?: PublicComment;
  onDone: () => void;
}) {
  const [text, setText] = useState(editing?.body ?? '');
  const [pending, setPending] = useState(false);
  const field = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  const submit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      if (editing) await comments.edit(editing.id, text);
      else await comments.create({ body: text, parentId: parentId! });
      onDone();
    } catch (error) {
      fail(error);
      setPending(false);
    }
  };
  return (
    <div className="comment-reply-box">
      <textarea
        ref={field}
        className="comment-input"
        data-testid={editing ? 'comment-edit-input' : 'comment-reply-input'}
        aria-label={editing ? 'Edit comment' : 'Reply'}
        rows={2}
        maxLength={MAX_COMMENT_BODY}
        placeholder="Write a reply…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <div className="comment-composer-row">
        <span className="comment-composer-spacer" />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!text.trim() || pending}
          onClick={() => void submit()}
          data-testid={editing ? 'comment-edit-save' : 'comment-reply-send'}
        >
          {editing ? 'Save' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}
