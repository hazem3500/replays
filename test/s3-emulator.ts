import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { type S3Credentials, signV4 } from '../src/server/storage/s3.ts';

export interface S3Emulator {
  endpoint: string;
  region: string;
  credentials: S3Credentials;
  /** A fresh, empty bucket. */
  bucket(): string;
  /** Every request seen: method and path+query. */
  requests: string[];
  stop(): Promise<void>;
}

interface Stored {
  body: Buffer;
  etag: string;
  modified: Date;
}

const xmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sendError(response: ServerResponse, status: number, code: string, message: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`;
  response.writeHead(status, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

/** Checks the SigV4 Authorization header by recomputing it from the request; returns an error message or undefined. */
function verify(request: IncomingMessage, body: Buffer, region: string, credentials: S3Credentials) {
  const authorization = request.headers.authorization ?? '';
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
      authorization,
    );
  if (!match) return 'malformed Authorization header';
  const [, accessKey, day, scopeRegion, signedHeaders] = match;
  if (accessKey !== credentials.accessKeyId) return 'unknown access key';
  if (scopeRegion !== region) return `wrong region in credential scope: ${scopeRegion}`;
  const stamp = String(request.headers['x-amz-date'] ?? '');
  if (!/^\d{8}T\d{6}Z$/.test(stamp) || !stamp.startsWith(day!)) return 'bad x-amz-date';
  if (
    Math.abs(Date.now() - Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))) >
    15 * 60_000
  )
    return 'request time skew';
  const names = signedHeaders!.split(';');
  for (const required of ['host', 'x-amz-date', 'x-amz-content-sha256']) if (!names.includes(required)) return `${required} not signed`;
  const declared = String(request.headers['x-amz-content-sha256'] ?? '');
  if (declared !== 'UNSIGNED-PAYLOAD' && declared !== createHash('sha256').update(body).digest('hex')) return 'payload hash mismatch';
  const headers: Record<string, string> = {};
  for (const name of names) if (name !== 'host') headers[name] = String(request.headers[name] ?? '');
  const expected = signV4({
    method: request.method ?? 'GET',
    url: new URL(`http://${request.headers.host}${request.url}`),
    headers,
    payloadHash: declared,
    region,
    credentials,
    now: new Date(Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))),
  });
  return expected.authorization === authorization ? undefined : 'signature does not match';
}

/** A tiny in-process S3 (path-style): object HEAD/GET/PUT/DELETE, ListObjectsV2, conditional headers, Range, SigV4 checks. */
export async function startS3Emulator(options: { pageSize?: number } = {}): Promise<S3Emulator> {
  const region = 'us-east-1';
  const credentials: S3Credentials = { accessKeyId: 'AKIAEMULATOREXAMPLE', secretAccessKey: 'emulator/secret/key+EXAMPLE' };
  const pageSize = options.pageSize ?? 3;
  const buckets = new Map<string, Map<string, Stored>>();
  const requests: string[] = [];
  let counter = 0;

  const handle = (request: IncomingMessage, response: ServerResponse, body: Buffer) => {
    requests.push(`${request.method} ${request.url}`);
    const problem = verify(request, body, region, credentials);
    if (problem) return sendError(response, 403, 'SignatureDoesNotMatch', problem);
    const url = new URL(request.url ?? '/', 'http://emulator');
    const [bucketName, ...rest] = url.pathname.slice(1).split('/').map(decodeURIComponent);
    const objects = bucketName ? buckets.get(bucketName) : undefined;
    if (!objects) return sendError(response, 404, 'NoSuchBucket', 'no such bucket');
    const key = rest.join('/');
    const method = request.method;

    if (!key) {
      if (method !== 'GET' || url.searchParams.get('list-type') !== '2')
        return sendError(response, 400, 'InvalidRequest', 'only ListObjectsV2');
      const prefix = url.searchParams.get('prefix') ?? '';
      const after = url.searchParams.has('continuation-token')
        ? Buffer.from(url.searchParams.get('continuation-token')!, 'base64url').toString()
        : '';
      const keys = [...objects.keys()]
        .filter((candidate) => candidate.startsWith(prefix) && candidate > after)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const page = keys.slice(0, pageSize);
      const truncated = keys.length > page.length;
      const contents = page
        .map((name) => {
          const object = objects.get(name)!;
          return `<Contents><Key>${xmlEscape(name)}</Key><LastModified>${object.modified.toISOString()}</LastModified><ETag>&quot;${object.etag}&quot;</ETag><Size>${object.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
        })
        .join('');
      const next = truncated ? `<NextContinuationToken>${Buffer.from(page.at(-1)!).toString('base64url')}</NextContinuationToken>` : '';
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucketName}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`;
      response.writeHead(200, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(xml) });
      return response.end(xml);
    }

    const existing = objects.get(key);
    if (method === 'PUT') {
      if (request.headers['if-none-match'] === '*' && existing) return sendError(response, 412, 'PreconditionFailed', 'exists');
      const ifMatch = request.headers['if-match'];
      if (ifMatch !== undefined) {
        if (!existing) return sendError(response, 404, 'NoSuchKey', 'no such key');
        if (ifMatch.replace(/"/g, '') !== existing.etag) return sendError(response, 412, 'PreconditionFailed', 'etag differs');
      }
      // Distinct writes get distinct ETags even for identical bodies, like a versioned bucket would.
      const etag = createHash('md5').update(body).update(String(++counter)).digest('hex');
      objects.set(key, { body, etag, modified: new Date() });
      response.writeHead(200, { etag: `"${etag}"`, 'content-length': 0 });
      return response.end();
    }
    if (method === 'DELETE') {
      objects.delete(key);
      response.writeHead(204);
      return response.end();
    }
    if (method === 'GET' || method === 'HEAD') {
      if (!existing) {
        if (method === 'HEAD') {
          response.writeHead(404);
          return response.end();
        }
        return sendError(response, 404, 'NoSuchKey', 'The specified key does not exist.');
      }
      const headers: Record<string, string | number> = {
        etag: `"${existing.etag}"`,
        'last-modified': existing.modified.toUTCString(),
        'accept-ranges': 'bytes',
      };
      let status = 200;
      let payload = existing.body;
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ''));
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : existing.body.byteLength - 1, existing.body.byteLength - 1);
        if (start >= existing.body.byteLength || start > end) return sendError(response, 416, 'InvalidRange', 'bad range');
        status = 206;
        payload = existing.body.subarray(start, end + 1);
        headers['content-range'] = `bytes ${start}-${end}/${existing.body.byteLength}`;
      }
      headers['content-length'] = payload.byteLength;
      response.writeHead(status, headers);
      return response.end(method === 'HEAD' ? undefined : payload);
    }
    return sendError(response, 405, 'MethodNotAllowed', 'method not allowed');
  };

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => handle(request, response, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    region,
    credentials,
    requests,
    bucket() {
      const name = `bucket-${++counter}`;
      buckets.set(name, new Map());
      return name;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
