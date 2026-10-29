// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBodyCapture } from './body-capture.ts';
import { captureNetwork, type RawNetworkEntry } from './capture.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl';
const SECRETS = /hunter2|s3cr3t-api|tok_live|4242 4242 4242 4242|jane@example\.com|eyJhbGci|Bearer abcdef/;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function record(options: { maskEmails?: boolean; maxBytes?: number } = {}) {
  const entries: RawNetworkEntry[] = [];
  const onBytes = vi.fn<(bytes: number) => void>();
  const restore = captureNetwork({
    allowedHeaders: ['content-type'],
    maxEntries: 10,
    ignore: () => false,
    onEntry: (entry) => entries.push(entry),
    bodies: createBodyCapture({
      limits: options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes },
      maskEmails: options.maskEmails ?? true,
      onBytes,
    }),
  });
  return { entries, onBytes, restore };
}

function stubFetch(response: Response | (() => Response)) {
  const fake = vi.fn<typeof fetch>(() => Promise.resolve(typeof response === 'function' ? response() : response));
  globalThis.fetch = fake;
  return fake;
}

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

const realFetch = globalThis.fetch;

describe('fetch bodies', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keeps the request and response bodies with every secret replaced', async () => {
    stubFetch(json({ user: { email: 'jane@example.com', apiKey: 's3cr3t-api' }, session: JWT, total: 42 }));
    const { entries, restore } = record();

    await fetch('https://shop.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jane@example.com', password: 'hunter2', card: '4242 4242 4242 4242', note: 'Bearer abcdefghijk' }),
    });
    await flush();
    restore();

    expect(JSON.stringify(entries)).not.toMatch(SECRETS);
    expect(entries[0]?.requestBody?.text).toBe(
      '{"email":"[redacted]","password":"[redacted]","card":"[redacted]","note":"Bearer [redacted]"}',
    );
    expect(entries[0]?.responseBody?.text).toBe('{"user":{"email":"[redacted]","apiKey":"[redacted]"},"session":"[redacted]","total":42}');
  });

  it('keeps e-mail addresses when page text is not masked', async () => {
    stubFetch(json({ owner: 'jane@example.com' }));
    const { entries, restore } = record({ maskEmails: false });
    await fetch('/api/owner');
    await flush();
    restore();
    expect(entries[0]?.responseBody?.text).toBe('{"owner":"jane@example.com"}');
  });

  it('redacts secret form fields', async () => {
    stubFetch(new Response('', { status: 204 }));
    const { entries, restore } = record();
    await fetch('/login', { method: 'POST', body: new URLSearchParams({ user: 'ada', password: 'hunter2', csrf_token: 'tok_live' }) });
    await flush();
    restore();
    expect(entries[0]?.requestBody?.text).toBe('user=ada&password=%5Bredacted%5D&csrf_token=%5Bredacted%5D');
  });

  it('reads a copy, so the page still gets the whole unread response', async () => {
    const response = json({ items: [1, 2, 3] });
    stubFetch(response);
    const { restore } = record();
    const received = await fetch('/api/cart');
    expect(received.bodyUsed).toBe(false);
    await expect(received.json()).resolves.toEqual({ items: [1, 2, 3] });
    restore();
  });

  it('cuts a body over the cap and marks it truncated', async () => {
    const text = JSON.stringify({ results: 'x'.repeat(5_000) });
    stubFetch(new Response(text, { headers: { 'content-type': 'application/json', 'content-length': String(text.length) } }));
    const { entries, onBytes, restore } = record({ maxBytes: 1_024 });
    await fetch('/api/search');
    await flush();
    restore();
    expect(entries[0]?.responseBody).toMatchObject({ size: text.length, truncated: true });
    expect(entries[0]?.responseBody?.text).toHaveLength(1_024);
    expect(onBytes).toHaveBeenCalledWith(1_024);
  });
});

describe('fetch bodies and the page', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('never reads server-sent events or binary bodies', async () => {
    let reply = new Response('data: 1\n\n', { headers: { 'content-type': 'text/event-stream' } });
    stubFetch(() => reply);
    const { entries, restore } = record();
    await fetch('/events');
    reply = new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
    await fetch('/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([123, 125]) });
    await flush();
    restore();
    expect(entries.map((entry) => entry.responseBody)).toEqual([{ omitted: 'content-type' }, { omitted: 'content-type' }]);
    expect(entries[1]?.requestBody).toEqual({ omitted: 'content-type' });
  });

  it('returns the response before its body arrives and gives up on it when recording stops', async () => {
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"waiting":'));
        close = () => controller.close();
      },
    });
    stubFetch(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    const { entries, restore } = record();
    const received = await fetch('/api/poll');
    await flush();
    expect(entries[0]?.responseBody).toEqual({ omitted: 'unavailable' });
    restore();
    close();
    await flush();
    expect(entries[0]?.responseBody).toEqual({ omitted: 'unavailable' });
    await expect(received.text()).resolves.toBe('{"waiting":');
  });

  it('swallows a body that fails to read and still hands the page its response', async () => {
    const response = json({ ok: true });
    vi.spyOn(response, 'clone').mockImplementation(() => {
      throw new TypeError('Response body is already used');
    });
    stubFetch(response);
    const { entries, restore } = record();
    await expect(fetch('/api/ok')).resolves.toBe(response);
    restore();
    expect(entries[0]?.responseBody).toEqual({ omitted: 'unavailable' });
  });

  it('records no response body for a failed request beyond saying it is unavailable', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    const { entries, restore } = record();
    await expect(
      fetch('/api/x', { method: 'POST', body: 'password=hunter2', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    ).rejects.toThrow('Failed to fetch');
    restore();
    expect(entries[0]).toMatchObject({ requestBody: { text: 'password=%5Bredacted%5D' }, responseBody: { omitted: 'unavailable' } });
  });
});

class FakeXhr extends EventTarget {
  static reply: { status: number; type: string; text: string; responseType?: XMLHttpRequestResponseType } = {
    status: 200,
    type: '',
    text: '',
  };
  status = 0;
  statusText = '';
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  response: unknown = '';
  open() {}
  setRequestHeader() {}
  send() {
    const reply = FakeXhr.reply;
    setTimeout(() => {
      this.status = reply.status;
      this.statusText = 'OK';
      this.responseType = reply.responseType ?? '';
      this.responseText = reply.text;
      this.response = reply.responseType === 'json' ? JSON.parse(reply.text) : reply.text;
      this.dispatchEvent(new Event('loadend'));
    });
  }
  getAllResponseHeaders() {
    return `content-type: ${FakeXhr.reply.type}\r\n`;
  }
  getResponseHeader(name: string) {
    return name === 'content-type' ? FakeXhr.reply.type : null;
  }
}

async function send(body: string, responseType?: XMLHttpRequestResponseType) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/coupon');
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (responseType) xhr.responseType = responseType;
  xhr.send(body);
  await new Promise((resolve) => xhr.addEventListener('loadend', resolve));
  return xhr;
}

describe('XHR bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the request and response text with every secret replaced', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    FakeXhr.reply = { status: 422, type: 'application/json', text: `{"error":"coupon_expired","token":"tok_live_1"}` };
    const { entries, restore } = record();
    const xhr = await send(JSON.stringify({ code: 'SPRING', authToken: JWT }));
    restore();
    expect(entries[0]).toMatchObject({
      status: 422,
      requestBody: { text: '{"code":"SPRING","authToken":"[redacted]"}' },
      responseBody: { text: '{"error":"coupon_expired","token":"[redacted]"}' },
    });
    expect(xhr.responseText).toContain('tok_live_1');
  });

  it('serializes a JSON response the page asked to have parsed', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    FakeXhr.reply = { status: 200, type: 'application/json', text: '{"password":"hunter2","items":2}', responseType: 'json' };
    const { entries, restore } = record();
    await send('{}', 'json');
    restore();
    expect(entries[0]?.responseBody?.text).toBe('{"password":"[redacted]","items":2}');
  });

  it('cuts long response text without measuring the whole string', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    FakeXhr.reply = { status: 200, type: 'text/plain', text: 'a'.repeat(10_000) };
    const { entries, restore } = record({ maxBytes: 100 });
    await send('{}');
    restore();
    expect(entries[0]?.responseBody).toEqual({ text: 'a'.repeat(100), truncated: true });
  });
});
