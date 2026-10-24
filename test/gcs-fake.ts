import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { globToRegExp } from '../src/server/storage/types.ts';

/**
 * An in-process stand-in for the parts of the Cloud Storage JSON API the gcs plugin uses: object metadata, media downloads with
 * ranges, multipart and resumable uploads with `ifGenerationMatch`, deletes, and paged listing with `prefix` and `matchGlob`. It
 * also serves the GCE metadata server's token endpoint. Requests must carry `Bearer <token>` when a token is set.
 */
export interface GcsFake {
  endpoint: string;
  /** host:port, as `GCE_METADATA_HOST` / `STORAGE_EMULATOR_HOST` take it. */
  host: string;
  /** A fresh, empty bucket name. */
  bucket(): string;
  /** Every request: `METHOD path?query`. */
  requests: string[];
  /** The token the API requires (undefined: none) and the one the metadata endpoint hands out. */
  token: string | undefined;
  /** Seconds the metadata endpoint says its token lives. */
  tokenLifetime: number;
  stop(): Promise<void>;
}

interface Stored {
  body: Buffer;
  generation: string;
  contentType: string;
  cacheControl: string | undefined;
  created: Date;
  updated: Date;
}

interface Session {
  bucket: string;
  name: string;
  contentType: string;
  cacheControl: string | undefined;
  size: number;
  ifGenerationMatch: string | null;
  chunks: Buffer[];
  received: number;
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

const error = (response: ServerResponse, status: number, message: string) => json(response, status, { error: { code: status, message } });

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The two parts of a `multipart/related` upload: JSON metadata and the media. */
function parseMultipart(body: Buffer, boundary: string) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let index = body.indexOf(delimiter);
  while (index >= 0) {
    const next = body.indexOf(delimiter, index + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(index + delimiter.length + 2, next - 2); // skip CRLF after the delimiter and before the next
    const split = part.indexOf('\r\n\r\n');
    parts.push(part.subarray(split + 4));
    index = next;
  }
  if (parts.length !== 2) throw new Error(`expected 2 parts, got ${parts.length}`);
  return { metadata: JSON.parse(parts[0]!.toString('utf8')) as Record<string, string>, media: parts[1]! };
}

export async function startGcsFake(options: { pageSize?: number } = {}): Promise<GcsFake> {
  const buckets = new Map<string, Map<string, Stored>>();
  const sessions = new Map<string, Session>();
  let generation = 1_700_000_000_000_000;
  let bucketCount = 0;
  let sessionCount = 0;
  const pageSize = options.pageSize ?? 1000;

  const resource = (bucket: string, name: string, object: Stored) => ({
    kind: 'storage#object',
    bucket,
    name,
    size: String(object.body.byteLength),
    generation: object.generation,
    contentType: object.contentType,
    ...(object.cacheControl ? { cacheControl: object.cacheControl } : {}),
    timeCreated: object.created.toISOString(),
    updated: object.updated.toISOString(),
  });

  /** Stores an object if the precondition holds; the response or the error status. */
  const put = (
    bucket: string,
    name: string,
    body: Buffer,
    meta: { contentType: string; cacheControl: string | undefined },
    match: string | null,
  ) => {
    const objects = buckets.get(bucket)!;
    const existing = objects.get(name);
    if (match !== null && (match === '0' ? existing !== undefined : existing?.generation !== match)) return 412;
    const now = new Date();
    const stored: Stored = { body, generation: String(++generation), ...meta, created: now, updated: now };
    objects.set(name, stored);
    return resource(bucket, name, stored);
  };

  const fake: GcsFake = {
    endpoint: '',
    host: '',
    requests: [],
    token: undefined,
    tokenLifetime: 3600,
    bucket() {
      const name = `bucket-${++bucketCount}`;
      buckets.set(name, new Map());
      return name;
    },
    stop: async () => {},
  };

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');
    fake.requests.push(`${request.method} ${url.pathname}${url.search}`);
    try {
      if (url.pathname === '/computeMetadata/v1/instance/service-accounts/default/token') {
        if (request.headers['metadata-flavor'] !== 'Google') return error(response, 403, 'missing Metadata-Flavor');
        return json(response, 200, { access_token: fake.token, expires_in: fake.tokenLifetime, token_type: 'Bearer' });
      }
      if (fake.token !== undefined && request.headers.authorization !== `Bearer ${fake.token}`) return error(response, 401, 'bad token');

      const session = url.searchParams.get('upload_id');
      if (session && request.method === 'PUT') {
        const state = sessions.get(session);
        if (!state) return error(response, 404, 'no such session');
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(request.headers['content-range'] ?? ''));
        const body = await readBody(request);
        if (!range || Number(range[1]) !== state.received || body.byteLength !== Number(range[2]) - Number(range[1]) + 1)
          return error(response, 400, 'bad content-range');
        state.chunks.push(body);
        state.received += body.byteLength;
        if (state.received < state.size) {
          response.writeHead(308, { range: `bytes=0-${state.received - 1}` });
          return response.end();
        }
        sessions.delete(session);
        const result = put(state.bucket, state.name, Buffer.concat(state.chunks), state, state.ifGenerationMatch);
        return result === 412 ? error(response, 412, 'precondition failed') : json(response, 200, result);
      }

      const upload = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(url.pathname);
      if (upload && request.method === 'POST') {
        const bucket = decodeURIComponent(upload[1]!);
        if (!buckets.has(bucket)) return error(response, 404, 'no such bucket');
        const match = url.searchParams.get('ifGenerationMatch');
        const body = await readBody(request);
        if (url.searchParams.get('uploadType') === 'multipart') {
          const boundary = /boundary=([^;]+)/.exec(String(request.headers['content-type']))?.[1];
          if (!boundary) return error(response, 400, 'no boundary');
          const { metadata, media } = parseMultipart(body, boundary);
          const result = put(
            bucket,
            metadata.name!,
            media,
            { contentType: metadata.contentType ?? 'application/octet-stream', cacheControl: metadata.cacheControl },
            match,
          );
          return result === 412 ? error(response, 412, 'precondition failed') : json(response, 200, result);
        }
        if (url.searchParams.get('uploadType') === 'resumable') {
          const metadata = JSON.parse(body.toString('utf8')) as Record<string, string>;
          // A create-only upload over an existing object fails when the session opens, as GCS does.
          const existing = buckets.get(bucket)!.get(metadata.name!);
          if (match !== null && (match === '0' ? existing !== undefined : existing?.generation !== match))
            return error(response, 412, 'precondition failed');
          const id = `session-${++sessionCount}`;
          sessions.set(id, {
            bucket,
            name: metadata.name!,
            contentType: metadata.contentType ?? String(request.headers['x-upload-content-type'] ?? 'application/octet-stream'),
            cacheControl: metadata.cacheControl,
            size: Number(request.headers['x-upload-content-length']),
            ifGenerationMatch: match,
            chunks: [],
            received: 0,
          });
          response.writeHead(200, { location: `${fake.endpoint}/upload/storage/v1/b/${upload[1]}/o?uploadType=resumable&upload_id=${id}` });
          return response.end();
        }
        return error(response, 400, 'unsupported uploadType');
      }

      const object = /^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
      if (object) {
        const bucket = decodeURIComponent(object[1]!);
        const name = decodeURIComponent(object[2]!);
        const objects = buckets.get(bucket);
        if (!objects) return error(response, 404, 'no such bucket');
        const stored = objects.get(name);
        if (request.method === 'DELETE') {
          if (!stored) return error(response, 404, 'no such object');
          objects.delete(name);
          response.writeHead(204);
          return response.end();
        }
        if (request.method !== 'GET') return error(response, 405, 'method');
        if (!stored) return error(response, 404, 'no such object');
        if (url.searchParams.get('alt') !== 'media') return json(response, 200, resource(bucket, name, stored));
        const range = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range ?? ''));
        const body = range ? stored.body.subarray(Number(range[1]), Number(range[2]) + 1) : stored.body;
        response.writeHead(range ? 206 : 200, {
          'content-type': stored.contentType,
          'content-length': body.byteLength,
          'x-goog-generation': stored.generation,
        });
        return response.end(body);
      }

      const listing = /^\/storage\/v1\/b\/([^/]+)\/o$/.exec(url.pathname);
      if (listing && request.method === 'GET') {
        const bucket = decodeURIComponent(listing[1]!);
        const objects = buckets.get(bucket);
        if (!objects) return error(response, 404, 'no such bucket');
        const prefix = url.searchParams.get('prefix') ?? '';
        const glob = url.searchParams.get('matchGlob');
        const pattern = glob ? globToRegExp(glob) : undefined;
        const names = [...objects.keys()].filter((name) => name.startsWith(prefix) && (!pattern || pattern.test(name))).sort();
        const start = Number(url.searchParams.get('pageToken') ?? 0);
        const size = Math.min(pageSize, Number(url.searchParams.get('maxResults') ?? 1000));
        const page = names.slice(start, start + size);
        return json(response, 200, {
          kind: 'storage#objects',
          items: page.map((name) => resource(bucket, name, objects.get(name)!)),
          ...(start + size < names.length ? { nextPageToken: String(start + size) } : {}),
        });
      }
      return error(response, 404, `unhandled ${request.method} ${url.pathname}`);
    } catch (failure) {
      return error(response, 500, failure instanceof Error ? failure.message : String(failure));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.host = `127.0.0.1:${port}`;
  fake.endpoint = `http://${fake.host}`;
  fake.stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}
