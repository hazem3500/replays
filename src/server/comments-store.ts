import { randomBytes } from 'node:crypto';

import { sanitizeUrlFields } from '../capture/sanitize.ts';
import {
  type CommentsFile,
  COMMENTS_VERSION,
  EMPTY_COMMENTS,
  MAX_COMMENTS,
  MAX_REPLIES,
  REACTION_EMOJI,
  type StoredAuthor,
  type StoredComment,
  cleanBody,
} from '../shared/comments.ts';
import { ObjectExistsError, type ObjectStorage, PreconditionFailedError, readJson } from './storage/types.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
/** A write that loses to another replica's is retried on the fresh file this many times (with a little jitter). */
const WRITE_ATTEMPTS = 12;

/**
 * Changes to one replay's comments in this process, one at a time: the filesystem driver checks versions without
 * a lock, so two overlapping writes in one process would both pass. Object stores also catch the race themselves
 * (`ifVersion`), which is what protects other replicas.
 */
const writing = new WeakMap<ObjectStorage, Map<string, Promise<unknown>>>();

/** An error the routes answer with `status`. */
export class CommentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CommentError';
    this.status = status;
  }
}

export interface NewComment {
  body?: unknown;
  at?: number;
  parentId?: string;
  emoji?: unknown;
}

/** `<id>/comments.json`: all of a replay's comments in one generation-checked document, deleted with the replay. */
export const commentsKey = (id: string) => `${id}/comments.json`;

function parse(value: unknown): CommentsFile {
  const file = value as Partial<CommentsFile> | undefined;
  if (!file || file.version !== COMMENTS_VERSION || !Array.isArray(file.comments)) return EMPTY_COMMENTS;
  return file as CommentsFile;
}

/**
 * Comments on the storage interface (src/server/storage/): the same code on the filesystem, S3 and memory drivers.
 * Every change is a read-modify-write checked against the object's version (`ifVersion` / `createOnly`), so two
 * replicas never lose each other's comments; a lost race re-reads and applies the change again.
 */
export class CommentsStore {
  private readonly storage: ObjectStorage;
  private readonly now: () => Date;

  constructor(storage: ObjectStorage, now: () => Date = () => new Date()) {
    this.storage = storage;
    this.now = now;
  }

  async list(replayId: string): Promise<StoredComment[]> {
    return parse(await readJson(this.storage, commentsKey(replayId)).catch(() => undefined)).comments;
  }

  /** Applies `change` to the stored comments and writes the result; retried on a concurrent write. */
  private async update<T>(replayId: string, change: (comments: StoredComment[]) => T): Promise<T> {
    let queues = writing.get(this.storage);
    if (!queues) writing.set(this.storage, (queues = new Map()));
    const key = commentsKey(replayId);
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.write(key, change));
    const tail = run.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => queues.get(key) === tail && queues.delete(key));
    return run;
  }

  private async write<T>(key: string, change: (comments: StoredComment[]) => T): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const info = await this.storage.stat(key);
      const current = info ? parse(await readJson(this.storage, key).catch(() => undefined)) : EMPTY_COMMENTS;
      const comments = [...current.comments];
      const result = change(comments);
      try {
        await this.storage.write(key, `${JSON.stringify({ version: COMMENTS_VERSION, comments } satisfies CommentsFile)}\n`, {
          contentType: JSON_TYPE,
          ...(info ? { ifVersion: info.version } : { createOnly: true }),
        });
        return result;
      } catch (error) {
        if (!(error instanceof PreconditionFailedError || error instanceof ObjectExistsError) || attempt >= WRITE_ATTEMPTS) throw error;
        await new Promise((wait) => setTimeout(wait, Math.random() * 15 * attempt));
      }
    }
  }

  /**
   * Adds a comment, reply or reaction. `span` is the replay's length (ms): a pin after its end is refused. Free text
   * gets the same URL privacy pass as uploads.
   */
  async create(replayId: string, input: NewComment, author: StoredAuthor, span: number): Promise<StoredComment> {
    const hasEmoji = input.emoji !== undefined;
    if (hasEmoji && (typeof input.emoji !== 'string' || !(REACTION_EMOJI as readonly string[]).includes(input.emoji)))
      throw new CommentError(400, `a reaction is one of ${REACTION_EMOJI.join(' ')}`);
    let body = '';
    if (hasEmoji) {
      if (input.body !== undefined && input.body !== '') throw new CommentError(400, 'a reaction has no text');
      if (input.parentId) throw new CommentError(400, 'a reaction cannot be a reply');
      if (input.at === undefined) throw new CommentError(400, 'a reaction is pinned to a moment: send "at"');
    } else {
      try {
        body = sanitizeUrlFields(cleanBody(input.body));
      } catch (error) {
        throw new CommentError(400, (error as Error).message);
      }
    }
    if (input.at !== undefined) {
      if (input.parentId) throw new CommentError(400, 'a reply sits in its thread and has no time of its own');
      if (typeof input.at !== 'number' || !Number.isFinite(input.at) || input.at < 0)
        throw new CommentError(400, 'at must be a time in ms (0 or more)');
      if (input.at > span) throw new CommentError(400, 'at is after the end of the replay');
    }
    const stored: StoredComment = {
      id: `c-${randomBytes(8).toString('hex').slice(0, 10)}`,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.at === undefined ? {} : { at: Math.round(input.at) }),
      body,
      ...(hasEmoji ? { emoji: input.emoji as string } : {}),
      author,
      createdAt: this.now().toISOString(),
    };
    return this.update(replayId, (comments) => {
      if (comments.length >= MAX_COMMENTS) throw new CommentError(409, `this replay has reached its limit of ${MAX_COMMENTS} comments`);
      if (input.parentId) {
        const parent = comments.find((comment) => comment.id === input.parentId);
        if (!parent) throw new CommentError(404, 'the comment you reply to does not exist');
        if (parent.parentId || parent.emoji) throw new CommentError(400, 'reply to the top-level comment of the thread');
        if (comments.filter((comment) => comment.parentId === parent.id).length >= MAX_REPLIES)
          throw new CommentError(409, `a thread holds at most ${MAX_REPLIES} replies`);
      }
      comments.push(stored);
      return stored;
    });
  }

  /** Changes the text of a comment its author wrote. */
  async edit(replayId: string, id: string, body: unknown, by: string): Promise<StoredComment> {
    let text: string;
    try {
      text = sanitizeUrlFields(cleanBody(body));
    } catch (error) {
      throw new CommentError(400, (error as Error).message);
    }
    return this.update(replayId, (comments) => {
      const index = comments.findIndex((comment) => comment.id === id);
      const comment = comments[index];
      if (!comment) throw new CommentError(404, 'comment not found');
      if (comment.author.id !== by) throw new CommentError(403, 'only the author can edit a comment');
      if (comment.emoji) throw new CommentError(400, 'a reaction has no text to edit');
      if (comment.body === text) return comment;
      const next = { ...comment, body: text, editedAt: this.now().toISOString() };
      comments[index] = next;
      return next;
    });
  }

  /** Resolves or reopens a thread (top-level comments); anyone who can open the replay may. */
  async setResolved(replayId: string, id: string, resolved: boolean, by: string): Promise<StoredComment> {
    return this.update(replayId, (comments) => {
      const index = comments.findIndex((comment) => comment.id === id);
      const comment = comments[index];
      if (!comment) throw new CommentError(404, 'comment not found');
      if (comment.parentId || comment.emoji) throw new CommentError(400, 'only a top-level comment can be resolved');
      const { resolved: _was, ...rest } = comment;
      const next: StoredComment = resolved ? { ...rest, resolved: { by, at: this.now().toISOString() } } : rest;
      comments[index] = next;
      return next;
    });
  }

  /** Deletes a comment its author wrote, with its replies. Returns how many comments went. */
  async remove(replayId: string, id: string, by: string): Promise<number> {
    return this.update(replayId, (comments) => {
      const comment = comments.find((candidate) => candidate.id === id);
      if (!comment) throw new CommentError(404, 'comment not found');
      if (comment.author.id !== by) throw new CommentError(403, 'only the author can delete a comment');
      const gone = comments.filter((candidate) => candidate.id === id || candidate.parentId === id);
      for (const doomed of gone) comments.splice(comments.indexOf(doomed), 1);
      return gone.length;
    });
  }
}
