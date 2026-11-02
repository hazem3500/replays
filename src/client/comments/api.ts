import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import type { CommentsResponse } from '../../shared/comments.ts';
import { commentsResponseSchema, publicCommentSchema, removedCommentsSchema } from '../../shared/schemas/comments.ts';
import { LoadError } from '../queries.ts';
import { apiUrl } from '../route.ts';

const url = (replayId: string, commentId?: string) =>
  apiUrl(`replays/${encodeURIComponent(replayId)}/comments${commentId ? `/${encodeURIComponent(commentId)}` : ''}`);

/** A refused write, with the server's reason (rate limit, permission, limits) fit to show as is. */
export class CommentRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CommentRequestError';
    this.status = status;
  }
}

const errorBodySchema = z.object({ error: z.string() });

async function failure(response: Response) {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));
  return new CommentRequestError(body.success ? body.data.error : `Request failed (${response.status})`, response.status);
}

export async function fetchComments(replayId: string, signal?: AbortSignal): Promise<CommentsResponse> {
  const response = await fetch(url(replayId), signal ? { signal } : {});
  if (!response.ok) throw new LoadError(`Comments failed to load (${response.status})`, response.status);
  return commentsResponseSchema.parse(await response.json());
}

export const commentsQuery = (replayId: string) =>
  queryOptions({
    queryKey: ['comments', replayId] as const,
    queryFn: ({ signal }) => fetchComments(replayId, signal),
    staleTime: 10_000,
    // why: other people's comments show up without a reload, but only while the tab is in front.
    refetchInterval: 30_000,
    retry: false,
  });

export interface NewCommentInput {
  body?: string;
  /** SOURCE time, ms. */
  at?: number;
  parentId?: string;
  emoji?: string;
}

interface Send<T> {
  method: string;
  replayId: string;
  commentId?: string | undefined;
  body?: unknown;
  schema: z.ZodType<T>;
}

async function send<T>({ method, replayId, commentId, body, schema }: Send<T>): Promise<T> {
  const response = await fetch(url(replayId, commentId), {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await failure(response);
  return schema.parse(await response.json());
}

export const createComment = (replayId: string, input: NewCommentInput) =>
  send({ method: 'POST', replayId, body: input, schema: publicCommentSchema });
export const editComment = (replayId: string, id: string, body: string) =>
  send({ method: 'PATCH', replayId, commentId: id, body: { body }, schema: publicCommentSchema });
export const resolveComment = (replayId: string, id: string, resolved: boolean) =>
  send({ method: 'PATCH', replayId, commentId: id, body: { resolved }, schema: publicCommentSchema });
export const deleteComment = (replayId: string, id: string) =>
  send({ method: 'DELETE', replayId, commentId: id, schema: removedCommentsSchema });
