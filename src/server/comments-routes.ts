import type { IncomingMessage, ServerResponse } from 'node:http';

import { cleanAvatarUrl, type CommentsResponse, displayName, publicComment, type StoredAuthor } from '../shared/comments.ts';
import { send } from './app.ts';
import { CommentError, type CommentsStore } from './comments-store.ts';
import type { Identity } from './auth/types.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { ReplayStore } from './store.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
/** A comment is at most 2000 characters; this leaves room for JSON escaping and nothing more. */
const MAX_BODY_BYTES = 32 * 1024;

/** Creating and editing are limited per person: this many in this long (see RateLimiter). */
export const COMMENT_RATE = { max: 20, windowMs: 60_000 } as const;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new CommentError(413, 'comment too large');
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CommentError(400, 'send a JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CommentError(400, 'send a JSON object');
  return parsed as Record<string, unknown>;
}

function only(input: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new CommentError(400, `${unknown} is not a supported field`);
}

/** The author record for an identity: with auth=none everyone is "Anonymous" (or the dev user the proxy named). */
export function authorOf(user: Identity, anonymousMode: boolean): StoredAuthor {
  const avatarUrl = cleanAvatarUrl(user.avatarUrl);
  return {
    id: user.id,
    ...(user.name ? { name: user.name.slice(0, 120) } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(anonymousMode ? { anonymous: true } : {}),
  };
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  send(response, status, JSON.stringify(body), JSON_TYPE, 'private, no-cache', headers);

/**
 * Comments on a replay, behind the auth adapter like the rest of the app (and the same-origin check for writes). Only
 * mounted with `comments.enabled` (the default; REPLAYS_COMMENTS=false turns it off and these paths are then plain
 * 404s). Anyone who can open a replay can read and write comments.
 *
 *   GET    /api/replays/<id>/comments        { comments, me, anonymous }
 *   POST   /api/replays/<id>/comments        { body, at?, parentId? } or { emoji, at }   → 201, the comment
 *   PATCH  /api/replays/<id>/comments/<cid>  { body } (author only) or { resolved: boolean }
 *   DELETE /api/replays/<id>/comments/<cid>  author only; a deleted top-level comment takes its replies along
 *
 * `at` is SOURCE time in ms (the recorded replay's own timeline, src/shared/comments.ts). Creating and editing text
 * are rate limited per person (429 with Retry-After). Authors are the auth adapter's identity (id, name, avatar);
 * with auth=none they are "Anonymous", and the id is never sent to other viewers (only `mine`). Returns false when
 * `path` is not a comments route.
 */
export async function handleCommentsApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: { store: ReplayStore; comments: CommentsStore; limiter: RateLimiter; user: Identity; anonymous: boolean },
) {
  const match = /^\/api\/replays\/([a-z0-9][a-z0-9-]{0,79})\/comments(?:\/([a-z0-9-]{1,40}))?$/.exec(path);
  if (!match) return false;
  const [, replayId = '', commentId] = match;
  const { store, comments, limiter, user, anonymous } = options;
  const method = request.method ?? 'GET';
  const allowed = commentId ? ['PATCH', 'DELETE'] : ['GET', 'HEAD', 'POST'];
  if (!allowed.includes(method)) {
    json(response, 405, { error: 'method not allowed' }, { allow: allowed.join(', ') });
    return true;
  }
  try {
    const span = await store.replaySpan(replayId);
    if (span === undefined) {
      json(response, 404, { error: 'replay not found' });
      return true;
    }
    const author = authorOf(user, anonymous);
    const meName = displayName(author);
    const limited = () => {
      const wait = limiter.hit(user.id);
      if (!wait) return false;
      json(
        response,
        429,
        { error: 'You are commenting too fast. Try again in a moment.', retryAfter: wait },
        { 'retry-after': String(wait) },
      );
      return true;
    };

    if (method === 'GET' || method === 'HEAD') {
      const body: CommentsResponse = {
        comments: (await comments.list(replayId)).map((comment) => publicComment(comment, user.id)),
        me: { name: meName, ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}), anonymous },
        anonymous,
      };
      json(response, 200, body);
      return true;
    }
    if (method === 'POST') {
      if (limited()) return true;
      const input = await readJson(request);
      only(input, ['body', 'at', 'parentId', 'emoji']);
      if (input.parentId !== undefined && (typeof input.parentId !== 'string' || !/^c-[a-z0-9]{1,40}$/.test(input.parentId)))
        throw new CommentError(400, 'parentId is not a comment id');
      if (input.at !== undefined && typeof input.at !== 'number') throw new CommentError(400, 'at must be a time in ms');
      const created = await comments.create(
        replayId,
        {
          body: input.body,
          emoji: input.emoji,
          ...(input.at === undefined ? {} : { at: input.at }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId as string }),
        },
        author,
        span,
      );
      console.log(`comments ${replayId}: ${created.id} added by ${user.id}`);
      json(response, 201, publicComment(created, user.id));
      return true;
    }
    if (method === 'PATCH') {
      const input = await readJson(request);
      only(input, ['body', 'resolved']);
      if ((input.body === undefined) === (input.resolved === undefined)) throw new CommentError(400, 'send either body or resolved');
      let updated;
      if (input.resolved !== undefined) {
        if (typeof input.resolved !== 'boolean') throw new CommentError(400, 'resolved must be true or false');
        updated = await comments.setResolved(replayId, commentId!, input.resolved, meName);
      } else {
        if (limited()) return true;
        updated = await comments.edit(replayId, commentId!, input.body, user.id);
      }
      json(response, 200, publicComment(updated, user.id));
      return true;
    }
    const removed = await comments.remove(replayId, commentId!, user.id);
    console.log(`comments ${replayId}: ${commentId} deleted by ${user.id}`);
    json(response, 200, { removed });
    return true;
  } catch (error) {
    if (!(error instanceof CommentError)) throw error;
    json(response, error.status, { error: error.message });
    return true;
  }
}
