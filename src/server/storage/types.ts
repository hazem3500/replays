import type { Readable } from 'node:stream';

/**
 * Where replays, their sidecars, list media, rendered MP4s, render job state and review suites live.
 * Keys are `/`-separated paths relative to the store's root (`<id>/replay.json`, `_suites/<id>.json`),
 * the same layout on every driver: `fs` (DATA_DIR on disk; dev, tests, the pre-live volume), `s3`
 * (an S3-compatible bucket) and `memory` (unit tests).
 */
export interface ObjectInfo {
  key: string;
  size: number;
  /**
   * Changes whenever the object's content changes: the object's ETag, or the file's mtime (ms, base 36)
   * on disk. Caches (summaries, compressed bodies, ETags) are keyed by it; `ifVersion` writes compare it.
   */
  version: string;
  /** Last write, ms since the epoch. */
  updatedMs: number;
  /** First write (upload) of this version, ms since the epoch. */
  createdMs: number;
}

export interface WriteOptions {
  /** Fail with ObjectExistsError when the key is already taken (S3 `If-None-Match: *`). */
  createOnly?: boolean;
  /** Fail with PreconditionFailedError unless the stored object is still at this version. */
  ifVersion?: string;
  contentType?: string;
  /** `Cache-Control` stored with the object (object stores only; the server sets its own on responses). */
  cacheControl?: string;
}

export interface ListOptions {
  /** Only keys starting with this (`_suites/`). */
  prefix?: string;
  /**
   * Only keys matching this glob: `*` (within one segment), `**` (any depth) and `{a,b}` alternatives,
   * e.g. `*\/{replay,meta}.json`. Object stores list by its literal prefix and filter the rest client-side.
   */
  glob?: string;
}

export interface ObjectStorage {
  readonly kind: 'fs' | 's3' | 'memory';
  /** For logs: the directory or `s3://bucket/prefix/`. */
  readonly description: string;
  stat(key: string): Promise<ObjectInfo | undefined>;
  /** The whole object, or undefined when there is none. */
  read(key: string): Promise<Buffer | undefined>;
  /** A stream of the object (or of the inclusive byte range); rejects with NotFoundError. */
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  /** Writes atomically: readers see the previous object or the whole new one, never a partial write. */
  write(key: string, body: Buffer | string, options?: WriteOptions): Promise<ObjectInfo>;
  /** Copies a finished local file (a render, a poster) into the store, atomically. */
  upload(key: string, localPath: string, options?: WriteOptions): Promise<ObjectInfo>;
  /** True when something was deleted. */
  delete(key: string): Promise<boolean>;
  /** Deletes every object under `prefix` (`<id>/`); returns how many. */
  deletePrefix(prefix: string): Promise<number>;
  list(options?: ListOptions): Promise<ObjectInfo[]>;
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(key: string) {
    super(`object ${key} does not exist`);
  }
}

export class ObjectExistsError extends Error {
  readonly status = 409;
  constructor(key: string) {
    super(`object ${key} already exists`);
  }
}

export class PreconditionFailedError extends Error {
  readonly status = 409;
  constructor(key: string) {
    super(`object ${key} changed concurrently`);
  }
}

/** Rejects keys that could escape the store's root or that no driver can hold. */
export function assertKey(key: string) {
  if (
    !key ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
  }
  return key;
}

/** The glob dialect of ListOptions (a common glob subset) as a RegExp over whole keys. */
export function globToRegExp(glob: string) {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      // `**/` matches zero or more whole segments; a trailing `**` anything.
      if (glob[index + 2] === '/') {
        source += '(?:[^/]+/)*';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      const close = glob.indexOf('}', index);
      if (close < 0) throw new Error(`unclosed { in glob ${glob}`);
      source += `(?:${glob
        .slice(index + 1, close)
        .split(',')
        .map((part) => part.replace(/[.+^${}()|[\]\\*?]/g, '\\$&'))
        .join('|')})`;
      index = close;
    } else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Most segments a key matching `glob` can have, or Infinity with `**` (lets the fs walk stop early). */
export function globDepth(glob: string | undefined) {
  if (!glob) return Number.POSITIVE_INFINITY;
  return glob.includes('**') ? Number.POSITIVE_INFINITY : glob.split('/').length;
}

export async function readText(storage: ObjectStorage, key: string) {
  return (await storage.read(key))?.toString('utf8');
}

/** The object parsed as JSON; undefined when missing or unparsable (a torn legacy write). */
export async function readJson<T = unknown>(storage: ObjectStorage, key: string): Promise<T | undefined> {
  const text = await readText(storage, key);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
