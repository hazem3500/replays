import { createHash, createHmac } from 'node:crypto';
import { readFile, stat as statFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

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

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Base URL of the service (`http://127.0.0.1:9000` for MinIO); default is AWS for the region. */
  endpoint?: string;
  /** Every key lives under `<prefix>/`. */
  prefix?: string;
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key` (MinIO, localstack, tests). */
  forcePathStyle?: boolean;
  credentials?: S3Credentials;
  fetcher?: typeof fetch;
}

/** An S3 request that failed in a way the storage contract has no name for. Never carries credentials. */
export class S3Error extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** Uploads are buffered (and hashed) whole; a single PUT cannot exceed 5 GB anyway. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DELETE_CONCURRENCY = 8;

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 wants it (`/` kept for paths). */
export function uriEncode(value: string, keepSlash = false) {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to send (and sign); `host` is added from the URL. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  region: string;
  service?: string;
  credentials: S3Credentials;
  now?: Date;
}

/** AWS Signature Version 4 (header form). Returns the headers to send: the input ones plus x-amz-* and Authorization. */
export function signV4(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3';
  const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value;
  headers['x-amz-date'] = stamp;
  headers['x-amz-content-sha256'] = input.payloadHash;
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken;

  const signing: Record<string, string> = { ...headers, host: input.url.host };
  const names = Object.keys(signing).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signing[name]!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const query = input.url.search
    .slice(1)
    .split('&')
    .filter(Boolean)
    .map((pair) => (pair.includes('=') ? pair : `${pair}=`))
    .sort();
  const canonicalRequest = [input.method, input.url.pathname, query.join('&'), canonicalHeaders, signedHeaders, input.payloadHash].join(
    '\n',
  );
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), input.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string) {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(\w+));/g, (whole, hex?: string, dec?: string, name?: string) => {
    if (hex || dec) return String.fromCodePoint(hex ? Number.parseInt(hex, 16) : Number(dec));
    return ENTITIES[name!] ?? whole;
  });
}

const tag = (xml: string, name: string) => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]!) : undefined;
};

const stripQuotes = (etag: string) => etag.replace(/^W\//, '').replace(/^"|"$/g, '');

/** The part of a glob before its first wildcard: all a server-side prefix filter can use. */
function literalPrefix(glob: string) {
  const wildcard = glob.search(/[*?{]/);
  return wildcard < 0 ? glob : glob.slice(0, wildcard);
}

/** Objects in an S3-compatible bucket (AWS, MinIO, R2, localstack), over `fetch` with SigV4 signing; no SDK. */
export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;
  /** A list is a few API pages: the store reuses one for 5 s (ObjectStorage.listCacheMs). */
  readonly listCacheMs = 5000;
  readonly description: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly base: URL;
  private readonly pathStyle: boolean;
  private readonly credentials: S3Credentials;
  private readonly fetcher: typeof fetch;

  constructor(options: S3StorageOptions) {
    if (!options.bucket) throw new Error('S3Storage needs a bucket');
    if (!options.credentials?.accessKeyId || !options.credentials.secretAccessKey) throw new Error('S3Storage needs credentials');
    this.bucket = options.bucket;
    this.region = options.region;
    this.credentials = options.credentials;
    this.fetcher = options.fetcher ?? fetch;
    this.prefix = (options.prefix ?? '').replace(/^\/+|\/+$/g, '');
    this.pathStyle = Boolean(options.forcePathStyle);
    this.base = new URL(options.endpoint ?? `https://s3.${options.region}.amazonaws.com`);
    this.description = `s3://${this.bucket}/${this.prefix ? `${this.prefix}/` : ''}`;
  }

  private objectKey(key: string) {
    return this.prefix ? `${this.prefix}/${assertKey(key)}` : assertKey(key);
  }

  private url(fullKey: string, query = '') {
    const url = new URL(this.base);
    const path = fullKey ? `/${uriEncode(fullKey, true)}` : '/';
    if (this.pathStyle) {
      url.pathname = `${this.base.pathname.replace(/\/+$/, '')}/${uriEncode(this.bucket)}${fullKey ? path : ''}`;
    } else {
      url.hostname = `${this.bucket}.${this.base.hostname}`;
      url.pathname = `${this.base.pathname.replace(/\/+$/, '')}${path}`;
    }
    url.search = query;
    return url;
  }

  private async request(method: string, url: URL, headers: Record<string, string> = {}, body?: Buffer) {
    const signed = signV4({
      method,
      url,
      headers,
      payloadHash: body ? sha256Hex(body) : EMPTY_SHA256,
      region: this.region,
      credentials: this.credentials,
    });
    return this.fetcher(url, {
      method,
      headers: signed,
      ...(body ? { body: body as unknown as BodyInit } : {}),
    });
  }

  private async fail(response: Response, action: string): Promise<never> {
    const text = await response.text().catch(() => '');
    const code = tag(text, 'Code');
    const message = tag(text, 'Message');
    throw new S3Error(
      response.status,
      code,
      `s3 ${action} failed: ${response.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`,
    );
  }

  private info(key: string, headers: Headers, size: number): ObjectInfo {
    const modified = Date.parse(headers.get('last-modified') ?? '');
    const ms = Number.isNaN(modified) ? Date.now() : modified;
    return { key, size, version: stripQuotes(headers.get('etag') ?? ''), updatedMs: ms, createdMs: ms };
  }

  async stat(key: string) {
    const response = await this.request('HEAD', this.url(this.objectKey(key)));
    if (response.status === 404) return undefined;
    if (!response.ok) return this.fail(response, 'HEAD');
    return this.info(key, response.headers, Number(response.headers.get('content-length') ?? 0));
  }

  async read(key: string) {
    const response = await this.request('GET', this.url(this.objectKey(key)));
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) return this.fail(response, 'GET');
    return Buffer.from(await response.arrayBuffer());
  }

  async stream(key: string, range?: { start: number; end: number }) {
    const response = await this.request('GET', this.url(this.objectKey(key)), range ? { range: `bytes=${range.start}-${range.end}` } : {});
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      throw new NotFoundError(key);
    }
    if (!response.ok) return this.fail(response, 'GET');
    return Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  }

  async write(key: string, body: Buffer | string, options: WriteOptions = {}) {
    const buffer = typeof body === 'string' ? Buffer.from(body) : body;
    const headers: Record<string, string> = {};
    if (options.contentType) headers['content-type'] = options.contentType;
    if (options.cacheControl) headers['cache-control'] = options.cacheControl;
    if (options.createOnly) headers['if-none-match'] = '*';
    if (options.ifVersion !== undefined) headers['if-match'] = `"${options.ifVersion}"`;
    const response = await this.request('PUT', this.url(this.objectKey(key)), headers, buffer);
    if (response.status === 412 || response.status === 409 || (response.status === 404 && options.ifVersion !== undefined)) {
      await response.arrayBuffer().catch(() => undefined);
      throw options.createOnly ? new ObjectExistsError(key) : new PreconditionFailedError(key);
    }
    if (!response.ok) return this.fail(response, 'PUT');
    await response.arrayBuffer().catch(() => undefined);
    const now = Date.now();
    return { key, size: buffer.byteLength, version: stripQuotes(response.headers.get('etag') ?? ''), updatedMs: now, createdMs: now };
  }

  async upload(key: string, localPath: string, options: WriteOptions = {}) {
    const { size } = await statFile(localPath);
    if (size > MAX_UPLOAD_BYTES) throw new Error(`${localPath} is ${size} bytes; uploads are limited to ${MAX_UPLOAD_BYTES}`);
    return this.write(key, await readFile(localPath), options);
  }

  async delete(key: string) {
    const fullKey = this.objectKey(key);
    // S3 answers 204 whether or not the key existed; HEAD first to tell the caller.
    if (!(await this.stat(key))) return false;
    const response = await this.request('DELETE', this.url(fullKey));
    if (!response.ok && response.status !== 404) return this.fail(response, 'DELETE');
    await response.arrayBuffer().catch(() => undefined);
    return true;
  }

  async deletePrefix(prefix: string) {
    const objects = await this.list({ prefix });
    let next = 0;
    const worker = async () => {
      while (next < objects.length) {
        const object = objects[next++]!;
        const response = await this.request('DELETE', this.url(this.objectKey(object.key)));
        if (!response.ok && response.status !== 404) await this.fail(response, 'DELETE');
        await response.arrayBuffer().catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, objects.length) }, worker));
    return objects.length;
  }

  async list(options: ListOptions = {}) {
    const pattern = options.glob ? globToRegExp(options.glob) : undefined;
    let prefix = options.prefix ?? '';
    if (options.glob) {
      const literal = literalPrefix(options.glob);
      if (literal.startsWith(prefix)) prefix = literal;
      else if (!prefix.startsWith(literal)) return [];
    }
    const root = this.prefix ? `${this.prefix}/` : '';
    const objects: ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const query = [`list-type=2`, `prefix=${uriEncode(root + prefix)}`, ...(token ? [`continuation-token=${uriEncode(token)}`] : [])]
        .sort()
        .join('&');
      const response = await this.request('GET', this.url('', query));
      if (!response.ok) return this.fail(response, 'list');
      const xml = await response.text();
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const entry = match[1]!;
        const fullKey = tag(entry, 'Key');
        if (fullKey === undefined || !fullKey.startsWith(root)) continue;
        const key = fullKey.slice(root.length);
        if (!key || key.endsWith('/') || (pattern && !pattern.test(key))) continue;
        const modified = Date.parse(tag(entry, 'LastModified') ?? '');
        const ms = Number.isNaN(modified) ? 0 : modified;
        objects.push({
          key,
          size: Number(tag(entry, 'Size') ?? 0),
          version: stripQuotes(tag(entry, 'ETag') ?? ''),
          updatedMs: ms,
          createdMs: ms,
        });
      }
      token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined;
    } while (token);
    return objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
