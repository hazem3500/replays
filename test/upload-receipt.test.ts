import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { receiptUrl, upload, UploadHttpError } from '../src/capture/bundle-io.ts';
import { uploadFields, uploadSummary } from '../src/capture/upload-report.ts';
import { createTerminal } from '../src/capture/terminal.ts';
import { REPLAY_FORMAT_VERSION, type ReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

const closeAll = () => Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function serve(handler: Handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/** Answers every request after its body is read, with the status the callback picks for the method. */
const reply =
  (
    status: (method: string | undefined) => number,
    body: (method: string | undefined) => string,
    headers: Record<string, string> = {},
  ): Handler =>
  (request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(status(request.method), headers);
      response.end(body(request.method));
    });
  };

async function withVideo(write = true): Promise<{ bundle: ReplayBundle; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'replays-receipt-'));
  if (write) await writeFile(join(dir, 'session.mp4'), Buffer.from('mp4-bytes'));
  const bundle = replay('with-video');
  bundle.meta.videoFile = 'session.mp4';
  return { bundle, dir };
}

describe('upload receipt and partial success', () => {
  afterEach(closeAll);

  it('returns the viewer link and a delivered video', async () => {
    const seen: string[] = [];
    const answer = reply(
      (method) => (method === 'POST' ? 201 : 204),
      (method) => (method === 'POST' ? JSON.stringify({ id: 'with-video', url: '/r/with-video' }) : ''),
      { 'content-type': 'application/json' },
    );
    const origin = await serve((request, response) => {
      seen.push(`${request.method} ${request.url}`);
      answer(request, response);
    });
    const { bundle, dir } = await withVideo();
    const result = await upload(bundle, dir, `${origin}/api/replays`);
    expect(result).toEqual({ id: 'with-video', url: `${origin}/r/with-video`, video: { uploaded: true } });
    expect(seen).toEqual(['POST /api/replays', 'PUT /api/replays/with-video/video']);
  });

  it('reports a video the server refused without failing the replay', async () => {
    const origin = await serve(
      reply(
        (method) => (method === 'POST' ? 201 : 500),
        () => '{"id":"with-video"}',
      ),
    );
    const { bundle, dir } = await withVideo();
    const result = await upload(bundle, dir, `${origin}/api/replays`);
    expect(result.url).toBe(`${origin}/r/with-video`);
    expect(result.video).toEqual({ uploaded: false, error: 'server refused the video (500)' });
    expect(uploadFields(result)).toMatchObject({ video: { uploaded: false } });
  });

  it('reports an unreadable video file as skipped', async () => {
    const origin = await serve(
      reply(
        () => 201,
        () => '{}',
      ),
    );
    const { bundle, dir } = await withVideo(false);
    const result = await upload(bundle, dir, `${origin}/api/replays`);
    expect(result.video).toEqual({ uploaded: false, error: 'the video file was not found next to replay.json' });
  });

  it('prints the partial success on one line', () => {
    const out = createTerminal({ env: {}, stream: Object.assign(new PassThrough(), { isTTY: true }) });
    const text = uploadSummary(out, { id: 'a', url: 'https://r.example/r/a', video: { uploaded: false, error: 'no ffmpeg' } });
    expect(text).toContain('Replay uploaded');
    expect(text).toContain('video skipped: no ffmpeg');
    expect(text).toContain('https://r.example/r/a');
  });

  it('derives the link from the endpoint when the receipt has none', () => {
    expect(receiptUrl('https://s.example/base/api/replays', 'abc', { id: 'abc' })).toBe('https://s.example/base/r/abc');
    expect(receiptUrl('https://s.example/api/replays', 'abc', { url: '/x/r/abc' })).toBe('https://s.example/x/r/abc');
    expect(receiptUrl('https://s.example/api/replays', 'abc', { url: 'https://evil.example/r/abc' })).toBe('https://s.example/r/abc');
  });
});

describe('format mismatch', () => {
  afterEach(closeAll);

  it('names both formats when the server rejects the bundle', async () => {
    const origin = await serve(
      reply(
        () => 400,
        () => 'replay.meta.source must be equal to one of the allowed values',
        { 'content-type': 'text/plain', 'x-replays-format': '2' },
      ),
    );
    const failure = await upload(replay('a'), tmpdir(), `${origin}/api/replays`).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UploadHttpError);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain('replay.meta.source');
    expect(message).toContain(`This CLI writes format ${REPLAY_FORMAT_VERSION}; the server expects 2.`);
    expect(message).toContain('replays update');
  });

  it('admits an older server that reports no format', async () => {
    const origin = await serve(
      reply(
        () => 400,
        () => 'bad',
      ),
    );
    const failure = await upload(replay('a'), tmpdir(), `${origin}/api/replays`).catch((error: unknown) => error);
    expect(failure instanceof Error ? failure.message : '').toContain('the server expects an older or unreported one');
  });
});
