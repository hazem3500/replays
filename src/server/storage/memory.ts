import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import {
  assertKey,
  globToRegExp,
  type ListOptions,
  NotFoundError,
  ObjectExistsError,
  type ObjectInfo,
  type ObjectStorage,
  PreconditionFailedError,
  type WriteOptions,
} from './types.ts';

/** Objects in a Map, with object-store-like generations: unit tests run the store against it as against the real drivers. */
export class MemoryStorage implements ObjectStorage {
  readonly kind = 'memory' as const;
  readonly description = 'memory';
  private readonly objects = new Map<string, { body: Buffer; info: ObjectInfo }>();
  private generation = 0;
  /** Wall clock for updated/created times; tests move it to age objects. */
  now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async stat(key: string) {
    const object = this.objects.get(assertKey(key));
    return object ? { ...object.info } : undefined;
  }

  async read(key: string) {
    const object = this.objects.get(assertKey(key));
    return object ? Buffer.from(object.body) : undefined;
  }

  async stream(key: string, range?: { start: number; end: number }) {
    const object = this.objects.get(assertKey(key));
    if (!object) throw new NotFoundError(key);
    return Readable.from([range ? object.body.subarray(range.start, range.end + 1) : object.body]);
  }

  async write(key: string, body: Buffer | string, options: WriteOptions = {}) {
    assertKey(key);
    const existing = this.objects.get(key);
    if (options.createOnly && existing) throw new ObjectExistsError(key);
    if (options.ifVersion !== undefined && existing?.info.version !== options.ifVersion) throw new PreconditionFailedError(key);
    const now = this.now();
    const info: ObjectInfo = { key, size: Buffer.byteLength(body), version: String(++this.generation), updatedMs: now, createdMs: now };
    this.objects.set(key, { body: Buffer.from(body), info });
    return { ...info };
  }

  async upload(key: string, localPath: string, options: WriteOptions = {}) {
    return this.write(key, await readFile(localPath), options);
  }

  async delete(key: string) {
    return this.objects.delete(assertKey(key));
  }

  async deletePrefix(prefix: string) {
    let count = 0;
    for (const key of this.objects.keys()) if (key.startsWith(prefix) && this.objects.delete(key)) count++;
    return count;
  }

  async list(options: ListOptions = {}) {
    const pattern = options.glob ? globToRegExp(options.glob) : undefined;
    return [...this.objects.values()]
      .map(({ info }) => info)
      .filter((info) => info.key.startsWith(options.prefix ?? '') && (!pattern || pattern.test(info.key)))
      .map((info) => ({ ...info }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Test helper: backdates an object as if it had been written at `ms`. */
  touch(key: string, ms: number) {
    const object = this.objects.get(assertKey(key));
    if (object) object.info = { ...object.info, updatedMs: ms, createdMs: ms };
  }
}
