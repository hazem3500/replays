import * as z from 'zod/mini';

import { type CommentsResponse, MAX_COMMENT_BODY, type PublicComment } from '../comments.ts';

/** A comment as served by `GET|POST|PATCH /api/replays/<id>/comments`. */
export const publicCommentSchema = z.object({
  id: z.string(),
  parentId: z.exactOptional(z.string()),
  at: z.exactOptional(z.number()),
  body: z.string().check(z.maxLength(MAX_COMMENT_BODY)),
  emoji: z.exactOptional(z.string()),
  author: z.object({
    name: z.string(),
    avatarUrl: z.exactOptional(z.string()),
    anonymous: z.exactOptional(z.literal(true)),
  }),
  createdAt: z.string(),
  editedAt: z.exactOptional(z.string()),
  resolved: z.exactOptional(z.object({ by: z.string(), at: z.string() })),
  mine: z.boolean(),
}) satisfies z.ZodMiniType<PublicComment>;

/** `GET /api/replays/<id>/comments`. */
export const commentsResponseSchema = z.object({
  comments: z.array(publicCommentSchema),
  me: z.object({ name: z.string(), avatarUrl: z.exactOptional(z.string()), anonymous: z.boolean() }),
  anonymous: z.boolean(),
}) satisfies z.ZodMiniType<CommentsResponse>;

/** `DELETE /api/replays/<id>/comments/<cid>`: how many comments went (a thread takes its replies along). */
export const removedCommentsSchema = z.object({ removed: z.number() });
