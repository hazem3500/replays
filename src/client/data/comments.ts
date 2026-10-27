import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { createCollection, useLiveQuery } from '@tanstack/react-db';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CommentsResponse, PublicComment } from '../../shared/comments.ts';
import {
  commentsQuery,
  createComment,
  deleteComment,
  editComment,
  fetchComments,
  type NewCommentInput,
  resolveComment,
} from '../comments/api.ts';
import { collectionFamily } from './registry.ts';
import { optimistic, wholeRows } from './write.ts';

const commentsFamily = collectionFamily((client, replayId) =>
  createCollection(
    wholeRows(
      queryCollectionOptions({
        id: `comments:${replayId}`,
        queryClient: client,
        queryKey: commentsQuery(replayId).queryKey,
        queryFn: ({ signal }) => fetchComments(replayId, signal),
        select: (response: CommentsResponse) => response.comments,
        getKey: (comment: PublicComment) => comment.id,
        staleTime: 10_000,
        // why: other people's comments show up without a reload, but only while the tab is in front.
        refetchInterval: 30_000,
        retry: false,
      }),
    ),
  ),
);

/**
 * A replay's comments as a collection over `['comments', id]`. The Query cache keeps the whole response, so `me` and
 * `anonymous` read from it; the collection holds the rows.
 */
export function commentsCollection(client: QueryClient, replayId: string) {
  return commentsFamily(client, replayId);
}

type Comments = ReturnType<typeof commentsCollection>;
type Me = CommentsResponse['me'] | undefined;

let drafts = 0;

/** The row a new comment shows as until the server answers; the server's row (and id) replaces it. */
function draftOf(input: NewCommentInput, me: Me): PublicComment {
  drafts += 1;
  return {
    id: `c-draft${drafts.toString(36).padStart(4, '0')}`,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.at === undefined || input.parentId ? {} : { at: Math.round(input.at) }),
    body: input.emoji ? '' : (input.body ?? '').trim(),
    ...(input.emoji ? { emoji: input.emoji } : {}),
    author: { name: me?.name ?? '', ...(me?.avatarUrl ? { avatarUrl: me.avatarUrl } : {}), ...(me?.anonymous ? { anonymous: true } : {}) },
    createdAt: new Date().toISOString(),
    mine: true,
  };
}

const ignoreMissing = () => {};

/** Writes that show on the frame they are made, are sent, and land as the server's rows; a refusal rolls back and rejects. */
function commentActions(comments: Comments, replayId: string, me: () => Me) {
  const land = async (saved: PublicComment) => {
    await comments.utils.writeUpsert(saved);
    return saved;
  };
  return {
    create: (input: NewCommentInput) =>
      optimistic(
        () => comments.insert(draftOf(input, me())),
        async () => land(await createComment(replayId, input)),
      ),
    edit: (id: string, body: string) =>
      optimistic(
        () => comments.update(id, (draft) => Object.assign(draft, { body: body.trim(), editedAt: new Date().toISOString() })),
        async () => land(await editComment(replayId, id, body)),
      ),
    resolve: (id: string, resolved: boolean) =>
      optimistic(
        () =>
          comments.update(id, (draft) =>
            Object.assign(draft, { resolved: resolved ? { by: me()?.name ?? '', at: new Date().toISOString() } : undefined }),
          ),
        async () => land(await resolveComment(replayId, id, resolved)),
      ),
    // why: a top-level comment takes its replies along, as the server does.
    remove: async (id: string) => {
      const keys = [...comments.values()].filter((comment) => comment.id === id || comment.parentId === id).map((comment) => comment.id);
      await optimistic(
        () => comments.delete(keys),
        async () => {
          await deleteComment(replayId, id);
          // why: one key at a time; a background refetch may already have dropped some, and writeDelete rejects a missing row.
          await Promise.all(keys.map((key) => comments.utils.writeDelete(key).catch(ignoreMissing)));
        },
      );
    },
  };
}

export interface CommentRows extends ReturnType<typeof commentActions> {
  /** Every comment, drafts included: a draft's `$synced` is false until the server has it. */
  comments: PublicComment[];
  loaded: boolean;
  error: Error | null;
  me: Me;
  anonymous: boolean;
  /** Loads the comments again (after a failed load). */
  retry: () => void;
}

/** The open replay's comments, live, with optimistic writes. */
export function useCommentRows(replayId: string): CommentRows {
  const client = useQueryClient();
  const comments = commentsCollection(client, replayId);
  // why: the collection's own query fetches; this observer only reads the response's `me` and `anonymous`.
  const response = useQuery({ ...commentsQuery(replayId), enabled: false, refetchInterval: false });
  const live = useLiveQuery({ query: (q) => q.from({ comment: comments }), queryKey: ['comments-rows', replayId] });
  const actions = commentActions(comments, replayId, () => client.getQueryData(commentsQuery(replayId).queryKey)?.me);
  return {
    ...actions,
    comments: live.data,
    loaded: live.isReady || response.data !== undefined,
    error: response.error,
    me: response.data?.me,
    anonymous: Boolean(response.data?.anonymous),
    retry: () => void comments.utils.refetch(),
  };
}
