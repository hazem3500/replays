// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureConsole, captureNetwork, type RawNetworkEntry } from './capture.ts';

describe('captureNetwork', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('records method, redacted URL, status and allow-listed headers only', async () => {
    const response = new Response('{"secret":true}', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': 'a=b',
      },
    });
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(response));
    globalThis.fetch = fake;
    const entries: RawNetworkEntry[] = [];
    const restore = captureNetwork({
      allowedHeaders: ['content-type'],
      maxEntries: 10,
      ignore: (url) => url.includes('/upload'),
      onEntry: (entry) => entries.push(entry),
    });

    await fetch('https://api.example.com/me?api_token=t', {
      method: 'post',
      headers: {
        authorization: 'Bearer x',
        'content-type': 'application/json',
      },
      body: '{"password":"hunter2"}',
    });
    await fetch('https://api.example.com/upload');
    restore();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/me?api_token=%5Bredacted%5D',
      status: 404,
      mimeType: 'application/json',
      requestHeaders: [{ name: 'content-type', value: 'application/json' }],
      responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }],
    });
    expect(JSON.stringify(entries)).not.toMatch(/hunter2|Bearer|secret/);
    // why: the response body was not consumed by the recorder.
    expect(response.bodyUsed).toBe(false);
    expect(globalThis.fetch).toBe(fake);
  });

  it('marks failed requests with status 0 and an error text', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    const entries: RawNetworkEntry[] = [];
    const restore = captureNetwork({
      allowedHeaders: [],
      maxEntries: 10,
      ignore: () => false,
      onEntry: (entry) => entries.push(entry),
    });
    await expect(fetch('/x')).rejects.toThrow('Failed to fetch');
    restore();
    expect(entries[0]).toMatchObject({
      status: 0,
      statusText: 'net::ERR_FAILED',
    });
  });
});

describe('captureConsole', () => {
  it('captures selected levels, redacts them, and restores the console', () => {
    const original = console.warn;
    const entries: { level: string; message: string }[] = [];
    const restore = captureConsole({
      levels: ['warn'],
      maxEntries: 1,
      onEntry: (entry) => entries.push(entry),
    });
    const silence = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    console.warn('mail me at jane@example.com');
    console.warn('over the cap');
    console.log('not captured');
    restore();
    silence.mockRestore();
    expect(entries).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'mail me at [redacted]',
      }),
    ]);
    expect(console.warn).toBe(original);
  });
});
