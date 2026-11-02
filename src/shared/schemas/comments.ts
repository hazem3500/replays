import { z } from 'zod';

import { type CommentsResponse, MAX_COMMENT_BODY, type PublicComment } from '../comments.ts';

/** A comment as served by `GET|POST|PATCH /api/replays/<id>/comments`. */
export const publicCommentSchema = z.object({
  id: z.string(),
  parentId: z.string().exactOptional(),
  at: z.number().exactOptional(),
  body: z.string().max(MAX_COMMENT_BODY),
  emoji: z.string().exactOptional(),
  author: z.object({
    name: z.string(),
    avatarUrl: z.string().exactOptional(),
    anonymous: z.literal(true).exactOptional(),
  }),
  createdAt: z.string(),
  editedAt: z.string().exactOptional(),
  resolved: z.object({ by: z.string(), at: z.string() }).exactOptional(),
  mine: z.boolean(),
}) satisfies z.ZodType<PublicComment>;

/** `GET /api/replays/<id>/comments`. */
export const commentsResponseSchema = z.object({
  comments: z.array(publicCommentSchema),
  me: z.object({ name: z.string(), avatarUrl: z.string().exactOptional(), anonymous: z.boolean() }),
  anonymous: z.boolean(),
}) satisfies z.ZodType<CommentsResponse>;

/** `DELETE /api/replays/<id>/comments/<cid>`: how many comments went (a thread takes its replies along). */
export const removedCommentsSchema = z.object({ removed: z.number() });
