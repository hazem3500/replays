/**
 * `@hazem3500/replays/plugins/gcs`: replays in a Google Cloud Storage bucket, over the JSON API with `fetch` (no SDK). A first-party
 * plugin: it uses only the public `/plugin` and `/server` surface.
 *
 *   import gcs from '@hazem3500/replays/plugins/gcs';
 *   export default defineConfig({ storage: 'gcs', plugins: [gcs({ bucket: 'acme-replays', prefix: 'replays' })] });
 */
import { open, stat as statFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { definePlugin } from '../plugin/index.ts';
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
} from '../server/index.ts';

/** Uploads above this go resumable (chunked); smaller ones in one request. */
export const RESUMABLE_BYTES = 8 * 1024 * 1024;
/** Resumable chunk size: a multiple of 256 KiB, as the API requires. */
const CHUNK_BYTES = 8 * 1024 * 1024;
const LIST_FIELDS = 'items(name,size,generation,updated,timeCreated),nextPageToken';
const METADATA_TOKEN_PATH = '/computeMetadata/v1/instance/service-accounts/default/token';

export interface GcsStorageOptions {
  bucket: string;
  /** Keys live under this prefix (`replays/`); empty for the bucket root. */
  prefix?: string;
  /** The API's base URL: an emulator, or a private endpoint. Default `https://storage.googleapis.com`. */
  endpoint?: string;
  /**
   * Where access tokens come from: a fixed token, a function, or (default) the GCE metadata server (Workload Identity on GKE, the
   * attached service account on Cloud Run and GCE), cached until shortly before it expires. `false`: send none (emulators).
   */
  token?: string | (() => string | Promise<string>) | false;
  /** The metadata server's host (`GCE_METADATA_HOST`). Default `metadata.google.internal`. */
  metadataHost?: string;
  fetch?: typeof fetch;
}

interface GcsObject {
  name?: string;
  size?: string | number;
  generation?: string | number;
  updated?: string;
  timeCreated?: string;
}

export class GcsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GcsError';
    this.status = status;
  }
}

/** Access tokens from the metadata server, cached until a minute before they expire; one request at a time. */
function metadataToken(host: string, fetcher: typeof fetch) {
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  return () => {
    if (cached && Date.now() < cached.until) return Promise.resolve(cached.token);
    pending ??= (async () => {
      try {
        const response = await fetcher(`http://${host}${METADATA_TOKEN_PATH}`, {
          headers: { 'metadata-flavor': 'Google' },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new GcsError(response.status, `metadata server token request answered ${response.status}`);
        const { access_token: token, expires_in: expiresIn } = (await response.json()) as { access_token?: string; expires_in?: number };
        if (!token) throw new Error('metadata server returned no access_token');
        cached = { token, until: Date.now() + Math.max(0, (Number(expiresIn) || 300) - 60) * 1000 };
        return token;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}

/**
 * Objects in a Cloud Storage bucket. Every object is private: the server streams them to signed-in browsers itself. Uploads are
 * atomic in GCS (an object appears only once its upload completes). Create-only writes use `ifGenerationMatch=0`, so two uploads
 * of one replay id cannot both win (the API answers 412, surfaced as `ObjectExistsError`); `ifVersion` writes use
 * `ifGenerationMatch=<generation>`. The generation is the version (ETag) of an object.
 */
export class GcsStorage implements ObjectStorage {
  readonly kind = 'gcs';
  /** A list is a few API pages: the store reuses one for 5 s. */
  readonly listCacheMs = 5000;
  readonly description: string;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  private readonly token: (() => string | Promise<string>) | undefined;

  constructor(options: GcsStorageOptions) {
    if (!options.bucket) throw new Error('GcsStorage needs a bucket');
    this.bucket = options.bucket;
    this.prefix = options.prefix ? `${options.prefix.replace(/^\/+|\/+$/g, '')}/` : '';
    this.description = `gs://${options.bucket}/${this.prefix}`;
    this.base = (options.endpoint ?? 'https://storage.googleapis.com').replace(/\/+$/, '');
    this.fetcher = options.fetch ?? fetch;
    const token = options.token;
    this.token =
      token === false
        ? undefined
        : typeof token === 'string'
          ? () => token
          : (token ?? metadataToken(options.metadataHost ?? 'metadata.google.internal', this.fetcher));
  }

  private name(key: string) {
    return `${this.prefix}${assertKey(key)}`;
  }

  private objectUrl(key: string, query: Record<string, string> = {}) {
    const url = new URL(`${this.base}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.name(key))}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }

  private async request(url: URL | string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('authorization', `Bearer ${await this.token()}`);
    return this.fetcher(url, { ...init, headers });
  }

  private async fail(response: Response, what: string): Promise<never> {
    const detail = await response.text().catch(() => '');
    let message = detail.slice(0, 300);
    try {
      message = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // Not JSON: keep the text.
    }
    throw new GcsError(response.status, `GCS ${what} failed (${response.status})${message ? `: ${message}` : ''}`);
  }

  private info(object: GcsObject, key = (object.name ?? '').slice(this.prefix.length)): ObjectInfo {
    const updatedMs = Date.parse(object.updated ?? '') || 0;
    return {
      key,
      size: Number(object.size ?? 0),
      version: String(object.generation ?? ''),
      updatedMs,
      createdMs: Date.parse(object.timeCreated ?? '') || updatedMs,
    };
  }

  private preconditions(key: string, options: WriteOptions): Record<string, string> {
    if (options.createOnly) return { ifGenerationMatch: '0' };
    if (options.ifVersion !== undefined) {
      // Versions are generations; anything else cannot be current.
      if (!/^\d+$/.test(options.ifVersion)) throw new PreconditionFailedError(key);
      return { ifGenerationMatch: options.ifVersion };
    }
    return {};
  }

  /** 412 is a lost precondition: the key exists (create-only) or moved on (`ifVersion`). */
  private async writeFailed(key: string, options: WriteOptions, response: Response): Promise<never> {
    if (response.status === 412) throw options.createOnly ? new ObjectExistsError(key) : new PreconditionFailedError(key);
    return this.fail(response, `write of ${key}`);
  }

  private metadata(key: string, options: WriteOptions) {
    return {
      name: this.name(key),
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
    };
  }

  async stat(key: string) {
    const response = await this.request(this.objectUrl(key));
    if (response.status === 404) return undefined;
    if (!response.ok) return this.fail(response, `stat of ${key}`);
    return this.info((await response.json()) as GcsObject, key);
  }

  async read(key: string) {
    const response = await this.request(this.objectUrl(key, { alt: 'media' }));
    if (response.status === 404) return undefined;
    if (!response.ok) return this.fail(response, `read of ${key}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async stream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const response = await this.request(this.objectUrl(key, { alt: 'media' }), {
      // Stored as is: the server negotiates compression with each browser.
      headers: { 'accept-encoding': 'identity', ...(range ? { range: `bytes=${range.start}-${range.end}` } : {}) },
    });
    if (response.status === 404) throw new NotFoundError(key);
    if (!response.ok) return this.fail(response, `read of ${key}`);
    if (!response.body) return Readable.from([]);
    return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  }

  async write(key: string, body: Buffer | string, options: WriteOptions = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bytes.byteLength > RESUMABLE_BYTES)
      return this.resumable(key, bytes.byteLength, options, async (start, end) => bytes.subarray(start, end));
    // One multipart request: the metadata (content type, cache control) and the bytes together.
    const boundary = `replays-${Math.random().toString(36).slice(2)}`;
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(this.metadata(key, options))}\r\n` +
          `--${boundary}\r\ncontent-type: ${options.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = new URL(`${this.base}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o`);
    for (const [name, value] of Object.entries({ uploadType: 'multipart', ...this.preconditions(key, options) }))
      url.searchParams.set(name, value);
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: payload,
    });
    if (!response.ok) return this.writeFailed(key, options, response);
    return this.info((await response.json()) as GcsObject, key);
  }

  async upload(key: string, localPath: string, options: WriteOptions = {}) {
    const { size } = await statFile(localPath);
    if (size <= RESUMABLE_BYTES) {
      const file = await open(localPath, 'r');
      try {
        return await this.write(key, await file.readFile(), options);
      } finally {
        await file.close();
      }
    }
    const file = await open(localPath, 'r');
    try {
      return await this.resumable(key, size, options, async (start, end) => {
        const chunk = Buffer.alloc(end - start);
        const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, start);
        return chunk.subarray(0, bytesRead);
      });
    } finally {
      await file.close();
    }
  }

  /** A resumable upload: open a session with the metadata and preconditions, then PUT the bytes in chunks. */
  private async resumable(key: string, size: number, options: WriteOptions, chunk: (start: number, end: number) => Promise<Buffer>) {
    const url = new URL(`${this.base}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o`);
    for (const [name, value] of Object.entries({ uploadType: 'resumable', ...this.preconditions(key, options) }))
      url.searchParams.set(name, value);
    const opened = await this.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-upload-content-length': String(size),
        ...(options.contentType ? { 'x-upload-content-type': options.contentType } : {}),
      },
      body: JSON.stringify(this.metadata(key, options)),
    });
    if (!opened.ok) return this.writeFailed(key, options, opened);
    const session = opened.headers.get('location');
    if (!session) throw new GcsError(opened.status, `GCS resumable upload of ${key} returned no session URL`);
    for (let start = 0; start < size; start += CHUNK_BYTES) {
      const end = Math.min(size, start + CHUNK_BYTES);
      const bytes = await chunk(start, end);
      const response = await this.request(session, {
        method: 'PUT',
        headers: { 'content-range': `bytes ${start}-${end - 1}/${size}` },
        // A copy typed over a plain ArrayBuffer, which fetch's BodyInit wants.
        body: Buffer.from(bytes),
      });
      if (response.status === 308) continue;
      if (!response.ok) return this.writeFailed(key, options, response);
      return this.info((await response.json()) as GcsObject, key);
    }
    throw new GcsError(500, `GCS resumable upload of ${key} did not complete`);
  }

  async delete(key: string) {
    const response = await this.request(this.objectUrl(key), { method: 'DELETE' });
    if (response.status === 404) return false;
    if (!response.ok) return this.fail(response, `delete of ${key}`);
    return true;
  }

  async deletePrefix(prefix: string) {
    const objects = await this.list({ prefix });
    let deleted = 0;
    // Bounded parallelism: a replay has a handful of objects, prune deletes a few at a time.
    for (let index = 0; index < objects.length; index += 16) {
      const results = await Promise.all(objects.slice(index, index + 16).map((object) => this.delete(object.key)));
      deleted += results.filter(Boolean).length;
    }
    return deleted;
  }

  async list(options: ListOptions = {}) {
    const objects: ObjectInfo[] = [];
    // GCS filters by matchGlob server-side; filtering again keeps emulators without it exact.
    const pattern = options.glob ? globToRegExp(options.glob) : undefined;
    let pageToken: string | undefined;
    do {
      const url = new URL(`${this.base}/storage/v1/b/${encodeURIComponent(this.bucket)}/o`);
      url.searchParams.set('prefix', `${this.prefix}${options.prefix ?? ''}`);
      if (options.glob) url.searchParams.set('matchGlob', `${this.prefix}${options.glob}`);
      url.searchParams.set('maxResults', '1000');
      url.searchParams.set('fields', LIST_FIELDS);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.request(url);
      if (!response.ok) return this.fail(response, 'list');
      const page = (await response.json()) as { items?: GcsObject[]; nextPageToken?: string };
      for (const item of page.items ?? []) {
        const info = this.info(item);
        if (!pattern || pattern.test(info.key)) objects.push(info);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return objects.sort((a, b) => a.key.localeCompare(b.key));
  }
}

export interface GcsPluginOptions {
  /** Env: `GCS_BUCKET`. */
  bucket?: string;
  /** Env: `GCS_PREFIX`. */
  prefix?: string;
}

/**
 * The storage the environment and options describe. Credentials: `GOOGLE_OAUTH_ACCESS_TOKEN` when set, else the metadata server.
 * Endpoint: `GCS_API_ENDPOINT`, else `STORAGE_EMULATOR_HOST` (an emulator: no token is sent unless one is set), else Google's.
 */
export function gcsStorageFromEnv(options: GcsPluginOptions, env: NodeJS.ProcessEnv): GcsStorage {
  const bucket = (options.bucket ?? env.GCS_BUCKET)?.trim();
  if (!bucket) throw new Error('gcs storage needs a bucket (GCS_BUCKET)');
  const prefix = (options.prefix ?? env.GCS_PREFIX)?.trim();
  const emulator = env.STORAGE_EMULATOR_HOST?.trim();
  const explicit = env.GCS_API_ENDPOINT?.trim();
  const endpoint = explicit || (emulator ? (/^https?:\/\//.test(emulator) ? emulator : `http://${emulator}`) : undefined);
  const staticToken = env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
  return new GcsStorage({
    bucket,
    ...(prefix ? { prefix } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(staticToken ? { token: staticToken } : emulator && !explicit ? { token: false as const } : {}),
    ...(env.GCE_METADATA_HOST?.trim() ? { metadataHost: env.GCE_METADATA_HOST.trim() } : {}),
  });
}

const plugin = definePlugin((options: GcsPluginOptions) => ({
  name: 'gcs',
  setup(api) {
    api.storage({ id: 'gcs', create: ({ env }) => gcsStorageFromEnv(options, env) });
  },
}));

/** The `gcs` plugin: registers the `gcs` storage backend (select it with `storage: 'gcs'` or `STORAGE=gcs`). */
export default function gcs(options: GcsPluginOptions = {}) {
  return plugin(options);
}
