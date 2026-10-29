import { memo, useMemo } from 'react';

import { activeThread, type PublicComment } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { clusterMarkers } from '../timeline.ts';
import { Avatar } from './Avatar.tsx';
import { type PlacedThread, useComments } from './CommentsProvider.tsx';
import './comments.css';

/** Markers drawn closer than this many pixels merge into one with a count: each keeps a whole 24 px target. */
const CLUSTER_GAP = 24;
/** Longest preview text (characters) on a marker's card and in its accessible name. */
const SNIPPET = 140;

function snippet(comment: PublicComment) {
  const text = comment.emoji ?? comment.body.replace(/\s+/g, ' ');
  return text.length > SNIPPET ? `${text.slice(0, SNIPPET - 1)}…` : text;
}

/**
 * Comments on the seek bar: at each pinned comment's moment on the timeline being watched, just above the bar, a tiny
 * avatar for a signed-in author or a small dot for an anonymous one. Hover or focus shows a preview card (who, when, the start of the text, reply count);
 * a click seeks there and selects the comment in the panel. Moments edited out are not drawn (they stay in the
 * panel, marked "in removed section"); reactions are drawn as their emoji. Markers close together merge into one
 * count, whose card lists the first few and whose click goes to the first.
 */
export const CommentMarkers = memo(function CommentMarkers({ width, inset }: { width: number; inset: number }) {
  const comments = useComments();
  const player = usePlayer();
  const duration = player.duration;
  const pins = comments?.pins;
  const clusters = useMemo(
    () =>
      pins && width > 0 && duration > 0
        ? clusterMarkers(
            pins.map((pin) => pin.at),
            duration,
            width,
            CLUSTER_GAP,
          ).map((cluster) => ({ ...cluster, members: cluster.indices.map((index) => pins[index]!) }))
        : [],
    [duration, pins, width],
  );
  const active = usePlayhead((time) =>
    pins
      ? activeThread(
          pins.map((pin) => ({ id: pin.thread.root.id, at: pin.at })),
          time,
        )
      : undefined,
  );
  if (!comments || clusters.length === 0) return null;
  return (
    <div className="comment-markers" data-testid="comment-markers">
      {clusters.map((cluster) => {
        const first = cluster.members[0]!;
        const root = first.thread.root;
        const x = inset + (Math.min(duration, Math.max(0, cluster.at)) / duration) * width;
        const side = x < 130 ? 'start' : x > width - 130 ? 'end' : 'center';
        const selected = cluster.members.some((member) => member.thread.root.id === comments.selectedId);
        const current = cluster.members.some((member) => member.thread.root.id === active);
        return (
          <div key={`${cluster.at}-${root.id}`} className="comment-marker" style={{ left: `${x}px` }} data-side={side}>
            <button
              type="button"
              className="comment-marker-button"
              data-testid="comment-marker"
              data-comment-id={root.id}
              data-selected={selected || undefined}
              data-current={current || undefined}
              data-resolved={cluster.members.every((member) => member.thread.root.resolved) || undefined}
              aria-label={markerLabel(
                cluster.members.map((member) => member.thread),
                cluster.at,
              )}
              onClick={() => comments.reveal(root.id, { open: false })}
            >
              {cluster.members.length > 1 ? (
                <span className="comment-marker-count">{cluster.members.length}</span>
              ) : root.emoji ? (
                <span className="comment-marker-emoji">{root.emoji}</span>
              ) : root.author.anonymous ? (
                <span className="comment-marker-dot" />
              ) : (
                <Avatar name={root.author.name} avatarUrl={root.author.avatarUrl} />
              )}
            </button>
            <div className="comment-card" role="presentation" aria-hidden="true" data-testid="comment-card">
              {cluster.members.slice(0, 3).map(({ thread, at }) => (
                <PreviewRow key={thread.root.id} thread={thread} at={at} />
              ))}
              {cluster.members.length > 3 ? <span className="comment-card-more">+{cluster.members.length - 3} more</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
});

function markerLabel(threads: PlacedThread[], at: number) {
  const first = threads[0]!.root;
  const who = first.author.name;
  const what = first.emoji ? `reacted ${first.emoji}` : `commented: ${snippet(first)}`;
  const more = threads.length > 1 ? ` and ${threads.length - 1} more` : '';
  return `${who} ${what}${more}, at ${formatClock(at)}`;
}

function PreviewRow({ thread, at }: { thread: PlacedThread; at: number }) {
  const { root, replies } = thread;
  return (
    <div className="comment-card-row">
      <Avatar name={root.author.name} avatarUrl={root.author.avatarUrl} anonymous={Boolean(root.author.anonymous)} />
      <div className="comment-card-text">
        <div className="comment-card-head">
          <strong>{root.author.name}</strong>
          <span>{formatClock(at)}</span>
        </div>
        <p>{snippet(root)}</p>
        {replies.length > 0 || root.resolved ? (
          <span className="comment-card-meta">
            {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : ''}
            {replies.length > 0 && root.resolved ? ' · ' : ''}
            {root.resolved ? 'Resolved' : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
