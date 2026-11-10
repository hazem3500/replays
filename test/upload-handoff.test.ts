import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { definePlugin, resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { renderHandoffPage } from '../src/server/api/upload-handoff.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import * as protocol from '../src/recorder/handoff-protocol.ts';
import { HANDOFF_CHANNEL, HANDOFF_PATH, HANDOFF_VERSION, MAX_HANDOFF_CHARS } from '../src/shared/upload-handoff.ts';
import { appDefaults } from './fixtures.ts';

const APP = 'https://app.example.com';
const allowlist = { origins: [APP], originPatterns: ['^https://[0-9]+-web\\.pull\\.example\\.com$'] };
const id = 'a'.repeat(32);
const base = { channel: HANDOFF_CHANNEL, version: HANDOFF_VERSION };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs the served page's script against a fake window, as the browser would after loading it. */
function loadPage({
  opener = true,
  fetchImpl,
}: { opener?: boolean; fetchImpl?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
  const html = renderHandoffPage(allowlist, 'nonce');
  const script = /<script nonce="nonce">([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  let onMessage: ((event: unknown) => void) | undefined;
  const status = { textContent: '' };
  const openerWindow = { closed: false, postMessage: vi.fn<(message: unknown, origin: string) => void>() };
  const close = vi.fn<() => void>();
  const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    fetchImpl ?? (() => Promise.resolve(new Response(JSON.stringify({ id: 'issue-1', url: '/r/issue-1' }), { status: 201 }))),
  );
  const timers: Array<() => void> = [];
  runInNewContext(script, {
    document: { getElementById: () => status },
    window: { opener: opener ? openerWindow : null, addEventListener: (_: string, fn: typeof onMessage) => (onMessage = fn), close },
    fetch: fetchFn,
    setTimeout: (fn: () => void) => timers.push(fn),
    Object,
    RegExp,
  });
  const deliver = (data: unknown, origin = APP, source: unknown = openerWindow) => onMessage?.({ data, origin, source });
  return { status, openerWindow, close, fetchFn, deliver, flush, timers };
}

const bundleMessage = { ...base, type: 'bundle', id, payload: '{"meta":{}}' };

describe('upload handoff page', () => {
  it('tells the opener it is ready, then uploads a bundle from an allowed origin and answers that origin only', async () => {
    const page = loadPage();
    expect(page.openerWindow.postMessage).toHaveBeenCalledWith({ ...base, type: 'ready' }, '*');
    page.deliver(bundleMessage);
    await page.flush();
    const call = page.fetchFn.mock.calls[0];
    expect(call?.[0]).toBe('api/replays');
    expect(call?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"meta":{}}' });
    expect(page.openerWindow.postMessage).toHaveBeenLastCalledWith(
      { ...base, type: 'receipt', id, ok: true, replayId: 'issue-1', url: '/r/issue-1' },
      APP,
    );
    for (const run of page.timers) run();
    expect(page.close).toHaveBeenCalled();
  });

  it('accepts a numbered preview origin the policy lists by pattern', async () => {
    const page = loadPage();
    page.deliver(bundleMessage, 'https://12-web.pull.example.com');
    await page.flush();
    expect(page.fetchFn).toHaveBeenCalledTimes(1);
    expect(page.openerWindow.postMessage).toHaveBeenLastCalledWith(expect.anything(), 'https://12-web.pull.example.com');
  });

  it('ignores a bundle from an unlisted origin, from another window, or with a bad shape', async () => {
    const page = loadPage();
    page.deliver(bundleMessage, 'https://evil.example');
    page.deliver(bundleMessage, 'https://app.example.com.evil.example');
    page.deliver(bundleMessage, APP, {});
    page.deliver({ ...bundleMessage, id: 'short' });
    page.deliver({ ...bundleMessage, payload: '' });
    page.deliver({ ...bundleMessage, type: 'other' });
    await page.flush();
    expect(page.fetchFn).not.toHaveBeenCalled();
  });

  it('uploads only once', async () => {
    const page = loadPage();
    page.deliver(bundleMessage);
    page.deliver(bundleMessage);
    await page.flush();
    expect(page.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal and a network failure', async () => {
    const refused = loadPage({ fetchImpl: () => Promise.resolve(new Response('no', { status: 403 })) });
    refused.deliver(bundleMessage);
    await refused.flush();
    expect(refused.openerWindow.postMessage).toHaveBeenLastCalledWith({ ...base, type: 'receipt', id, ok: false, status: 403 }, APP);

    const offline = loadPage({ fetchImpl: () => Promise.reject(new TypeError('failed')) });
    offline.deliver(bundleMessage);
    await offline.flush();
    expect(offline.openerWindow.postMessage).toHaveBeenLastCalledWith({ ...base, type: 'receipt', id, ok: false, status: 0 }, APP);
  });

  it('says to retry in the app when it lost its opener (for example after signing in)', () => {
    const page = loadPage({ opener: false });
    expect(page.status.textContent).toContain('Retry');
    expect(page.fetchFn).not.toHaveBeenCalled();
  });
});

describe('handoff messages', () => {
  it('parses only well-formed messages of the wanted types', () => {
    expect(protocol.parseHandoffMessage({ ...base, type: 'ready' })?.type).toBe('ready');
    expect(protocol.parseHandoffMessage({ ...base, type: 'receipt', id, ok: true, replayId: 'x1' })?.type).toBe('receipt');
    expect(protocol.parseHandoffMessage({ ...base, type: 'receipt', id, ok: true, replayId: '../x' })).toBeUndefined();
    expect(
      protocol.parseHandoffMessage({ ...base, type: 'receipt', id, ok: true, replayId: 'x1', url: 'https://evil.example' }),
    ).toBeUndefined();
    expect(protocol.parseHandoffMessage({ ...base, version: 2, type: 'ready' })).toBeUndefined();
    expect(protocol.parseHandoffMessage('ready')).toBeUndefined();
  });

  it('keeps the recorder and server halves of the protocol in step', () => {
    expect([protocol.HANDOFF_PATH, protocol.HANDOFF_CHANNEL, protocol.HANDOFF_VERSION, protocol.MAX_HANDOFF_CHARS]).toEqual([
      HANDOFF_PATH,
      HANDOFF_CHANNEL,
      HANDOFF_VERSION,
      MAX_HANDOFF_CHARS,
    ]);
  });
});

async function start(origins: string[]) {
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples');
  const plugins = await resolvePlugins([
    definePlugin({
      name: 'host',
      setup(api) {
        if (origins.length)
          api.requestPolicy({ path: '/api/replays', methods: ['POST'], origins, headers: ['content-type'], credentials: true });
      },
    }),
  ]);
  const app = createApp({ ...appDefaults(), store, plugins, clientDir: '/nonexistent-client' });
  const server = createServer((req, res) => void app(req, res));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

describe('GET /upload', () => {
  it('serves the page with the request policy origins, a nonce CSP and no cache', async () => {
    const origin = await start([APP]);
    const response = await fetch(`${origin}/upload`);
    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = /nonce-([^']+)'/.exec(csp)?.[1] ?? '';
    expect(nonce).not.toBe('');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
    const html = await response.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain(JSON.stringify([APP]));
  });

  it('is not served when no app origin may upload', async () => {
    const origin = await start([]);
    expect((await fetch(`${origin}/upload`)).status).toBe(404);
  });
});
