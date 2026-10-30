/**
 * Comments on a replay: whole-replay notes, or notes pinned to a moment, with replies, resolve and emoji reactions.
 *
 * Stored next to the replay (`<id>/comments.json`, src/server/comments-store.ts), so retention deletes them with it.
 * Every `at` is on the SOURCE timeline: ms from the first rrweb event of the recorded replay, the same clock saved
 * edits (src/shared/edits.ts) use for their trims and cuts. A comment therefore never moves when someone edits the
 * replay; the viewer maps it onto the edited timeline for display (`placeComment`) and back when one is created
 * (`sourceTimeAt`).
 */
import type { EditTimeline } from './edits.ts';

export const COMMENTS_VERSION = 1;
/** Longest comment body, in characters. */
export const MAX_COMMENT_BODY = 2000;
/** Most comments (replies and reactions included) one replay holds. */
export const MAX_COMMENTS = 500;
/** Most replies under one comment. */
export const MAX_REPLIES = 100;
/** Reactions are one of these (a fixed set keeps them renderable everywhere and free of free-form text). */
export const REACTION_EMOJI = ['👍', '🎉', '👀', '🤔', '🐛'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export const COMMENT_ID = /^c-[a-z0-9]{6,20}$/;

/** Who wrote a comment, as the auth adapter reported them (`id` stays on the server). */
export interface StoredAuthor {
  id: string;
  name?: string;
  avatarUrl?: string;
  /** Written with auth=none: the name is "Anonymous" and the author cannot be told apart from anyone else. */
  anonymous?: boolean;
}

export interface StoredComment {
  id: string;
  /** The top-level comment this replies to; replies have no `at` of their own (they sit in their thread). */
  parentId?: string;
  /** SOURCE time, ms (rounded); absent: about the whole replay. */
  at?: number;
  /** Text; empty for a reaction. */
  body: string;
  /** A reaction pinned at `at` (one of REACTION_EMOJI), instead of text. */
  emoji?: string;
  author: StoredAuthor;
  createdAt: string;
  /** Set when the body was edited. */
  editedAt?: string;
  /** Top-level comments only. */
  resolved?: { by: string; at: string };
}

export interface CommentsFile {
  version: typeof COMMENTS_VERSION;
  comments: StoredComment[];
}

export const EMPTY_COMMENTS: CommentsFile = { version: COMMENTS_VERSION, comments: [] };

/** A comment as served: the author's id is replaced by `mine`, so identities (emails) never reach other viewers. */
export interface PublicComment {
  id: string;
  parentId?: string;
  at?: number;
  body: string;
  emoji?: string;
  author: { name: string; avatarUrl?: string; anonymous?: true };
  createdAt: string;
  editedAt?: string;
  resolved?: { by: string; at: string };
  /** Written by the person asking: only they may edit or delete it. */
  mine: boolean;
}

/** `GET /api/replays/<id>/comments`. */
export interface CommentsResponse {
  comments: PublicComment[];
  /** The caller, as new comments will show them. */
  me: { name: string; avatarUrl?: string; anonymous: boolean };
  /** No sign-in (auth=none): comments are labelled "Anonymous" and anyone may change anonymous ones. */
  anonymous: boolean;
}

export const ANONYMOUS_NAME = 'Anonymous';

/** Display name for an identity: its name, else the part of the id before an `@`, else the id. */
export function displayName(author: StoredAuthor) {
  if (author.anonymous && (!author.name || author.id === 'anonymous')) return ANONYMOUS_NAME;
  const name = author.name?.trim() || author.id.split('@')[0]!.trim();
  return name || ANONYMOUS_NAME;
}

export function publicComment(comment: StoredComment, viewerId: string): PublicComment {
  const name = displayName(comment.author);
  return {
    id: comment.id,
    ...(comment.parentId ? { parentId: comment.parentId } : {}),
    ...(comment.at === undefined ? {} : { at: comment.at }),
    body: comment.body,
    ...(comment.emoji ? { emoji: comment.emoji } : {}),
    author: {
      name,
      ...(comment.author.avatarUrl ? { avatarUrl: comment.author.avatarUrl } : {}),
      ...(comment.author.anonymous ? { anonymous: true as const } : {}),
    },
    createdAt: comment.createdAt,
    ...(comment.editedAt ? { editedAt: comment.editedAt } : {}),
    ...(comment.resolved ? { resolved: comment.resolved } : {}),
    mine: comment.author.id === viewerId,
  };
}

// oxlint-disable-next-line no-control-regex -- control characters are exactly what is stripped
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Bidirectional overrides and isolates: they can make text read as something it is not. */
const BIDI = /[‪-‮⁦-⁩]/g;

/**
 * A comment body as stored: normalized (NFC, `\n` line ends), stripped of control and bidi-override characters,
 * trimmed, and at most `MAX_COMMENT_BODY` characters. Throws a message fit for a 400.
 */
export function cleanBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('body must be text');
  const body = raw
    .normalize('NFC')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(CONTROL, '')
    .replace(BIDI, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!body) throw new Error('write something first');
  if ([...body].length > MAX_COMMENT_BODY) throw new Error(`a comment is at most ${MAX_COMMENT_BODY} characters`);
  return body;
}

/** An avatar must be an https image URL (or a data: image the adapter embedded); anything else is dropped. */
export function cleanAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}


/** Where a comment sits on the timeline being watched. */
export type Placement =
  /** About the whole replay: no marker. */
  | { state: 'general' }
  /** On the watched timeline at `at` ms (the source time itself when nothing was edited). */
  | { state: 'visible'; at: number }
  /** Its moment was trimmed off or cut: listed, but no marker and no seeking. */
  | { state: 'removed' };

type TimelineLike = Pick<EditTimeline, 'toEdited' | 'isRemoved'>;

/**
 * Where a comment pinned at SOURCE time `at` shows on the watched timeline: the same ms without edits, the edited time
 * (after trims, cuts and speed-ups) with them, and `removed` when edits took that moment out.
 */
export function placeComment(at: number | undefined, timeline?: TimelineLike): Placement {
  if (at === undefined) return { state: 'general' };
  if (!timeline) return { state: 'visible', at };
  if (timeline.isRemoved(at)) return { state: 'removed' };
  return { state: 'visible', at: Math.round(timeline.toEdited(at)) };
}

/** The SOURCE time of playhead position `time` on the watched timeline: what a new comment is stored at. */
export function sourceTimeAt(time: number, timeline?: Pick<EditTimeline, 'toOriginal'>): number {
  return Math.max(0, Math.round(timeline ? timeline.toOriginal(time) : time));
}


export interface CommentThread {
  root: PublicComment;
  replies: PublicComment[];
}

/**
 * Threads in time order: whole-replay comments first (oldest first), then pinned ones by source time (ties by when
 * they were written). Replies follow their root, oldest first; a reply whose root is gone is dropped.
 */
export function threadsOf(comments: readonly PublicComment[]): CommentThread[] {
  const byTime = (a: PublicComment, b: PublicComment) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const roots = comments.filter((comment) => !comment.parentId);
  const general = roots.filter((comment) => comment.at === undefined).sort(byTime);
  const pinned = roots.filter((comment) => comment.at !== undefined).sort((a, b) => a.at! - b.at! || byTime(a, b));
  return [...general, ...pinned].map((root) => ({
    root,
    replies: comments.filter((comment) => comment.parentId === root.id).sort(byTime),
  }));
}

/**
 * The thread the panel highlights at playhead `time` (watched timeline): the latest visible pinned one at or before it,
 * else the first one still ahead (the nearest, before anything has been reached). Undefined without visible pins.
 */
export function activeThread(placed: ReadonlyArray<{ id: string; at: number }>, time: number): string | undefined {
  let current: string | undefined;
  let currentAt = Number.NEGATIVE_INFINITY;
  let next: { id: string; at: number } | undefined;
  for (const item of placed) {
    if (item.at <= time) {
      if (item.at >= currentAt) {
        current = item.id;
        currentAt = item.at;
      }
    } else if (!next || item.at < next.at) next = item;
  }
  return current ?? next?.id;
}
