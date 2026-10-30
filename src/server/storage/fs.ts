import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';

import {
  assertKey,
  globDepth,
  globToRegExp,
  type ListOptions,
  NotFoundError,
  ObjectExistsError,
  type ObjectInfo,
  type ObjectStorage,
  PreconditionFailedError,
  type WriteOptions,
} from './types.ts';

const DIR_MODE = 0o750;
const FILE_MODE = 0o640;

const temporaryName = (path: string) => `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

/**
 * Objects as files under `root` (DATA_DIR): `<root>/<key>`. Writes go to a temporary file and are renamed
 * (or, create-only, hard-linked) into place, so readers never see a partial file. This is the layout the
 * server has always used, so an existing volume needs no migration.
 */
export class FsStorage implements ObjectStorage {
  readonly kind = 'fs' as const;
  readonly root: string;
  readonly description: string;

  constructor(root: string) {
    this.root = root;
    this.description = root;
  }

  /** The file behind `key` (tests, and the fs-only sample directory). */
  path(key: string) {
    return join(this.root, ...assertKey(key).split('/'));
  }

  private info(key: string, info: { size: number; mtimeMs: number }): ObjectInfo {
    return { key, size: info.size, version: Math.floor(info.mtimeMs).toString(36), updatedMs: info.mtimeMs, createdMs: info.mtimeMs };
  }

  async stat(key: string) {
    const info = await stat(this.path(key)).catch(() => undefined);
    return info?.isFile() ? this.info(key, info) : undefined;
  }

  async read(key: string) {
    return readFile(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
  }

  async stream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const path = this.path(key);
    if (!(await stat(path).catch(() => undefined))?.isFile()) throw new NotFoundError(key);
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  private async place(key: string, fill: (temporary: string) => Promise<void>, options: WriteOptions) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
    if (options.ifVersion !== undefined && (await this.stat(key))?.version !== options.ifVersion) throw new PreconditionFailedError(key);
    const temporary = temporaryName(path);
    try {
      await fill(temporary);
      if (options.createOnly) {
        // why: link() fails when the name exists, so two racing creators cannot both win (rename would overwrite).
        await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
          throw error.code === 'EEXIST' ? new ObjectExistsError(key) : error;
        });
      } else {
        await rename(temporary, path);
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return (await this.stat(key))!;
  }

  write(key: string, body: Buffer | string, options: WriteOptions = {}) {
    return this.place(key, (temporary) => writeFile(temporary, body, { mode: FILE_MODE, flag: 'wx' }), options);
  }

  upload(key: string, localPath: string, options: WriteOptions = {}) {
    return this.place(key, (temporary) => copyFile(localPath, temporary), options);
  }

  async delete(key: string) {
    const path = this.path(key);
    const existed = Boolean((await stat(path).catch(() => undefined))?.isFile());
    await rm(path, { force: true });
    if (existed && dirname(path) !== this.root) await rmdir(dirname(path)).catch(() => undefined);
    return existed;
  }

  async deletePrefix(prefix: string) {
    const objects = await this.list({ prefix });
    // why: A `<id>/` prefix is a directory here: remove it whole, temporary leftovers included.
    if (prefix.endsWith('/')) {
      const directory = this.path(prefix.slice(0, -1));
      const exists = Boolean((await stat(directory).catch(() => undefined))?.isDirectory());
      await rm(directory, { recursive: true, force: true });
      return Math.max(objects.length, exists ? 1 : 0);
    }
    for (const object of objects) await rm(this.path(object.key), { force: true });
    return objects.length;
  }

  async list(options: ListOptions = {}) {
    const pattern = options.glob ? globToRegExp(options.glob) : undefined;
    const prefix = options.prefix ?? '';
    const maxDepth = globDepth(options.glob);
    // why: start at the deepest directory the prefix names, and stop descending past the glob's depth.
    const startKey = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const start = startKey ? this.path(startKey) : this.root;
    const keys: string[] = [];
    const walk = async (directory: string, depth: number) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        entries.map(async (entry) => {
          const path = join(directory, entry.name);
          const key = relative(this.root, path).split(sep).join('/');
          if (entry.isDirectory()) {
            if (depth + 1 < maxDepth && (key.startsWith(prefix) || prefix.startsWith(`${key}/`))) await walk(path, depth + 1);
          } else if (entry.isFile() && key.startsWith(prefix) && (!pattern || pattern.test(key))) {
            // why: in-flight `*.tmp` files are listed too (an unglobbed list): prune clears the ones a crash left.
            keys.push(key);
          }
        }),
      );
    };
    await walk(start, startKey ? startKey.split('/').length : 0);
    const infos = await Promise.all(keys.map((key) => this.stat(key)));
    return infos.filter((info): info is ObjectInfo => Boolean(info)).sort((a, b) => a.key.localeCompare(b.key));
  }
}
