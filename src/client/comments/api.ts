import { queryOptions } from '@tanstack/react-query';

import type { CommentsResponse, PublicComment } from '../../shared/comments.ts';
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

async function failure(response: Response) {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return new CommentRequestError(body?.error ?? `Request failed (${response.status})`, response.status);
}

export async function fetchComments(replayId: string, signal?: AbortSignal): Promise<CommentsResponse> {
  const response = await fetch(url(replayId), signal ? { signal } : {});
  if (!response.ok) throw new LoadError(`Comments failed to load (${response.status})`, response.status);
  return (await response.json()) as CommentsResponse;
}

export const commentsQuery = (replayId: string) =>
  queryOptions({
    queryKey: ['comments', replayId] as const,
    queryFn: ({ signal }) => fetchComments(replayId, signal),
    staleTime: 10_000,
    // Other people's comments show up without a reload, but only while the tab is in front.
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

async function send<T>(method: string, replayId: string, commentId: string | undefined, body?: unknown): Promise<T> {
  const response = await fetch(url(replayId, commentId), {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export const createComment = (replayId: string, input: NewCommentInput) => send<PublicComment>('POST', replayId, undefined, input);
export const editComment = (replayId: string, id: string, body: string) => send<PublicComment>('PATCH', replayId, id, { body });
export const resolveComment = (replayId: string, id: string, resolved: boolean) => send<PublicComment>('PATCH', replayId, id, { resolved });
export const deleteComment = (replayId: string, id: string) => send<{ removed: number }>('DELETE', replayId, id);
