import { createCollection, localOnlyCollectionOptions, useLiveQuery } from '@tanstack/react-db';
import { useQueryClient } from '@tanstack/react-query';

import type { PublicComment } from '../../shared/comments.ts';
import type { NewCommentInput } from '../comments/api.ts';
import type { CommentRows } from './comments.ts';
import { collectionFamily } from './registry.ts';

/** A comment the server refused: kept on screen as "Not sent", with what to send again. */
export interface FailedComment extends PublicComment {
  failure: string;
  input: NewCommentInput;
}

/** A post the server refused; its text stays on screen as the "Not sent" row `failedId`. */
export class CommentNotSentError extends Error {
  readonly failedId: string;
  constructor(message: string, failedId: string) {
    super(message);
    this.name = 'CommentNotSentError';
    this.failedId = failedId;
  }
}

/** Where a comment stands: on the server, on its way there, or refused. */
export type CommentState = 'sent' | 'sending' | 'failed';

const failedFamily = collectionFamily((_client, replayId) =>
  createCollection(localOnlyCollectionOptions<FailedComment, string>({ id: `comments-failed:${replayId}`, getKey: (row) => row.id })),
);

let failures = 0;

function failedRow(input: NewCommentInput, rows: CommentRows, error: unknown): FailedComment {
  failures += 1;
  const me = rows.me;
  return {
    id: `c-failed${failures.toString(36).padStart(4, '0')}`,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.at === undefined || input.parentId ? {} : { at: Math.round(input.at) }),
    body: input.emoji ? '' : (input.body ?? '').trim(),
    ...(input.emoji ? { emoji: input.emoji } : {}),
    author: { name: me?.name ?? '', ...(me?.avatarUrl ? { avatarUrl: me.avatarUrl } : {}), ...(me?.anonymous ? { anonymous: true } : {}) },
    createdAt: new Date().toISOString(),
    mine: true,
    failure: error instanceof Error ? error.message : 'Could not save the comment',
    input,
  };
}

/** Where `comment` stands: refused rows carry their failure, drafts are not yet synced. */
export function commentState(comment: PublicComment): CommentState {
  if ('failure' in comment) return 'failed';
  return '$synced' in comment && comment.$synced === false ? 'sending' : 'sent';
}

export interface CommentDrafts {
  /** The comments with the refused ones in place, so a thread keeps what its author wrote. */
  comments: PublicComment[];
  /** Posts like `rows.create`; a refusal leaves a "Not sent" row and rejects with CommentNotSentError. */
  create: CommentRows['create'];
  /** Sends a refused comment again; it shows as a draft until the server answers. */
  resend: (id: string) => Promise<PublicComment | undefined>;
  discard: (id: string) => void;
}

/** Keeps refused comments on screen (local only, this page) so their text is never lost and can be sent again. */
export function useCommentDrafts(replayId: string, rows: CommentRows): CommentDrafts {
  const failed = failedFamily(useQueryClient(), replayId);
  const live = useLiveQuery({ query: (q) => q.from({ row: failed }), queryKey: ['comments-failed', replayId] });
  const create: CommentRows['create'] = async (input) => {
    try {
      return await rows.create(input);
    } catch (error) {
      const row = failedRow(input, rows, error);
      failed.insert(row);
      throw new CommentNotSentError(row.failure, row.id);
    }
  };
  return {
    comments: live.data.length ? [...rows.comments, ...live.data] : rows.comments,
    create,
    resend: async (id) => {
      const row = failed.get(id);
      if (!row) return;
      failed.delete(id);
      return create(row.input);
    },
    discard: (id) => {
      if (failed.has(id)) failed.delete(id);
    },
  };
}
