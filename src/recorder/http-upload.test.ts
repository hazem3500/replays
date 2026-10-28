// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it, onTestFinished } from 'vitest';

import type { ReplayBundle } from './bundle-types.ts';
import { createHttpUpload } from './http-upload.ts';
import { IssueUploadError } from './upload.ts';

const bundle: ReplayBundle = {
  meta: {
    id: 'issue-1',
    title: 'Issue',
    url: 'https://app.example.com/',
    capturedAt: '2026-10-27T00:00:00.000Z',
    duration: 1,
    viewport: { width: 1, height: 1 },
    eventCount: 0,
    version: 1,
    source: 'human',
  },
  events: [],
  console: [],
  network: [],
  steps: [],
};

type Seen = { headers: IncomingMessage['headers']; body: Buffer };

/** A local stand-in for an upload endpoint: records each request and answers with `reply`. */
async function fakeServer(reply: (response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ headers: request.headers, body: Buffer.concat(chunks) });
      reply(response);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  onTestFinished(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${address.port}/api/ingest/v1/recordings`, seen };
}

const answer =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (response: ServerResponse) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  };

const signal = () => new AbortController().signal;

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof IssueUploadError)) throw error;
    return { status: error.status, retryable: error.retryable, retryAfterMs: error.retryAfterMs };
  }
  throw new Error('expected the upload to fail');
}

describe('createHttpUpload', () => {
  it('posts the report as gzip JSON with the headers a function returns', async () => {
    const server = await fakeServer(answer(201, { id: 'stored-1' }));
    const upload = createHttpUpload({ url: server.url, headers: () => Promise.resolve({ 'x-app-key': 'key-1' }) });
    await upload({ bundle, note: 'broken' }, { signal: signal() });
    const [request] = server.seen;
    expect([request?.headers['x-app-key'], request?.headers['content-encoding'], request?.headers.cookie]).toEqual([
      'key-1',
      'gzip',
      undefined,
    ]);
    expect(JSON.parse(gunzipSync(request?.body ?? Buffer.alloc(0)).toString())).toEqual({ bundle, note: 'broken' });
  });

  it('returns the receipt id, reference and replayUrl', async () => {
    const server = await fakeServer(
      answer(201, { id: 'stored-1', reference: 'REF-1', replayUrl: 'https://replays.example.com/r/stored-1' }),
    );
    const receipt = await createHttpUpload({ url: server.url })({ bundle }, { signal: signal() });
    expect(receipt).toEqual({ replayId: 'stored-1', reference: 'REF-1', url: 'https://replays.example.com/r/stored-1' });
  });

  it('falls back to the core receipt url', async () => {
    const server = await fakeServer(answer(201, { id: 'stored-1', url: '/r/stored-1' }));
    expect(await createHttpUpload({ url: server.url })({ bundle }, { signal: signal() })).toEqual({
      replayId: 'stored-1',
      url: '/r/stored-1',
    });
  });

  it('sends a custom body as is', async () => {
    const server = await fakeServer(answer(201, { id: 'stored-1' }));
    await createHttpUpload({ url: server.url, body: (report) => JSON.stringify(report.bundle) })({ bundle }, { signal: signal() });
    expect([server.seen[0]?.headers['content-encoding'], JSON.parse(server.seen[0]?.body.toString() ?? '')]).toEqual([undefined, bundle]);
  });

  it('marks 429 retryable and honours Retry-After', async () => {
    const server = await fakeServer(answer(429, { error: 'slow down' }, { 'retry-after': '30' }));
    expect(await failure(createHttpUpload({ url: server.url })({ bundle }, { signal: signal() }))).toEqual({
      status: 429,
      retryable: true,
      retryAfterMs: 30_000,
    });
  });

  it('marks server errors retryable', async () => {
    const server = await fakeServer(answer(503, { error: 'internal error' }));
    expect((await failure(createHttpUpload({ url: server.url })({ bundle }, { signal: signal() }))).retryable).toBe(true);
  });

  it('marks a refused credential as not retryable', async () => {
    const server = await fakeServer(answer(403, 'origin not allowed for this app'));
    expect(await failure(createHttpUpload({ url: server.url })({ bundle }, { signal: signal() }))).toEqual({
      status: 403,
      retryable: false,
      retryAfterMs: undefined,
    });
  });

  it('fails retryably when the server does not answer in time', async () => {
    const server = await fakeServer(() => {});
    expect(await failure(createHttpUpload({ url: server.url, timeoutMs: 50 })({ bundle }, { signal: signal() }))).toEqual({
      status: 0,
      retryable: true,
      retryAfterMs: undefined,
    });
  });

  it('passes the caller abort through instead of a transport error', async () => {
    const server = await fakeServer(() => {});
    const controller = new AbortController();
    const pending = createHttpUpload({ url: server.url })({ bundle }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(IssueUploadError);
  });

  it('refuses a receipt without a valid replay id', async () => {
    const server = await fakeServer(answer(201, { id: '../etc' }));
    expect((await failure(createHttpUpload({ url: server.url })({ bundle }, { signal: signal() }))).retryable).toBe(false);
  });
});
