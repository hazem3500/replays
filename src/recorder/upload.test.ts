// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CompressionStream as NodeCompressionStream } from 'node:stream/web';
import { gunzipSync } from 'node:zlib';

import type { ReplayBundle } from './bundle-types.ts';
import { createTokenUpload, IssueUploadError } from './upload.ts';

const bundle = { meta: { id: 'issue-1' } } as unknown as ReplayBundle;

function okResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createTokenUpload', () => {
  it('posts the report with a fresh bearer token and no cookies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(okResponse({ id: 'issue-2026-abc', url: 'https://replays/x' })));
    const getToken = vi.fn<() => Promise<string>>(() => Promise.resolve('short-lived'));
    const upload = createTokenUpload({
      endpoint: 'https://gateway.example/api/issue-reports',
      getToken,
      compress: false,
      fetch,
    });
    const receipt = await upload({ bundle, note: 'hi' }, { signal: new AbortController().signal });
    // The replay URL in the response is never surfaced.
    expect(receipt).toEqual({ replayId: 'issue-2026-abc' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example/api/issue-reports');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ authorization: 'Bearer short-lived' });
    expect(JSON.parse(init.body as string)).toEqual({ bundle, note: 'hi' });
  });

  it('gzips the body when CompressionStream exists', async () => {
    // Use the real compression implementation under the DOM harness.
    vi.stubGlobal('CompressionStream', NodeCompressionStream);
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(okResponse({ id: 'issue-1' })));
    const upload = createTokenUpload({
      endpoint: '/ingest',
      getToken: () => Promise.resolve('t'),
      fetch,
    });
    await upload({ bundle }, { signal: new AbortController().signal });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'content-encoding': 'gzip' });
    const body = Buffer.from(init.body as ArrayBuffer);
    expect(JSON.parse(gunzipSync(body).toString())).toEqual({ bundle });
    vi.unstubAllGlobals();
  });

  it('fails on HTTP errors and on responses without a valid id', async () => {
    const signal = new AbortController().signal;
    const failing = createTokenUpload({
      endpoint: '/ingest',
      getToken: () => Promise.resolve('t'),
      compress: false,
      fetch: () => Promise.resolve(new Response('', { status: 413 })),
    });
    await expect(failing({ bundle }, { signal })).rejects.toMatchObject({
      name: 'IssueUploadError',
      status: 413,
    });
    const invalid = createTokenUpload({
      endpoint: '/ingest',
      getToken: () => Promise.resolve('t'),
      compress: false,
      fetch: () => Promise.resolve(okResponse({ id: '../etc' })),
    });
    await expect(invalid({ bundle }, { signal })).rejects.toBeInstanceOf(IssueUploadError);
  });
});
