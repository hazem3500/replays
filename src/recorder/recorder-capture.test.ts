// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRecorderMessages } from './messages.ts';
import { createRecorder } from './recorder.ts';
import { must } from './testing.ts';
import { createFakeRrweb, createFakeTransport } from './testing/fakes.ts';
import type { PrivacyFacts, RecorderOptions, RecorderUi } from './types.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const realFetch = globalThis.fetch;

async function recordOneRequest(options: Partial<RecorderOptions>, body = { owner: 'jane@example.com', token: 'tok_live_123' }) {
  globalThis.fetch = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })),
  );
  const rrweb = createFakeRrweb();
  const transport = createFakeTransport();
  const recorder = createRecorder({ upload: transport.upload, loadRrweb: rrweb.load, activation: () => true, ...options });
  await recorder.start({ consent: true });
  await fetch('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"hunter2"}' });
  await flush();
  rrweb.emit({ type: 3, timestamp: Date.now() + 1_000, data: {} });
  recorder.stop();
  await recorder.upload({ confirmed: true });
  return must(transport.reports[0]).bundle;
}

describe('recorder capture option', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('uploads redacted request and response bodies and says so in meta.captured', async () => {
    const bundle = await recordOneRequest({ capture: { network: 'bodies' } });
    expect(bundle.meta.captured).toEqual({ console: true, network: 'bodies', performance: false, video: false });
    expect(bundle.network[0]).toMatchObject({
      requestBody: { text: '{"password":"[redacted]"}' },
      responseBody: { text: '{"owner":"[redacted]","token":"[redacted]"}' },
    });
  });

  it('declares visible inputs in meta.captured only when privacy.sanitize is false', async () => {
    expect((await recordOneRequest({ privacy: { sanitize: false } })).meta.captured?.inputs).toBe('visible');
    expect(await recordOneRequest({})).not.toHaveProperty('meta.captured.inputs');
  });

  it('reads no body by default and marks the network as headers only', async () => {
    const bundle = await recordOneRequest({});
    expect(bundle.meta.captured?.network).toBe('headers');
    expect(bundle.network[0]).not.toHaveProperty('requestBody');
    expect(bundle.network[0]).not.toHaveProperty('responseBody');
  });

  it('keeps the network off when privacy.captureNetwork is false, whatever capture asks', async () => {
    const bundle = await recordOneRequest({ capture: { network: 'bodies' }, privacy: { captureNetwork: false } });
    expect(bundle.meta.captured?.network).toBe('off');
    expect(bundle.network).toEqual([]);
  });

  it('keeps e-mail addresses in bodies while page text is visible', async () => {
    const bundle = await recordOneRequest({ capture: { network: 'bodies' }, privacy: { maskAllText: false } });
    expect(bundle.network[0]?.responseBody?.text).toContain('jane@example.com');
  });

  it('lets a profile mask what the privacy options left visible', async () => {
    const bundle = await recordOneRequest({
      capture: { network: 'bodies', privacy: { maskAllText: true } },
      privacy: { maskAllText: false },
    });
    expect(bundle.network[0]?.responseBody?.text).not.toContain('jane@example.com');
  });
});

describe('recorder capture limits', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('counts kept bodies toward the size cap', async () => {
    const rrweb = createFakeRrweb();
    globalThis.fetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ rows: 'x'.repeat(4_000) }), { headers: { 'content-type': 'application/json' } })),
    );
    const recorder = createRecorder({
      upload: createFakeTransport().upload,
      loadRrweb: rrweb.load,
      activation: () => true,
      maxBytes: 2_048,
      capture: { network: 'bodies' },
    });
    await recorder.start({ consent: true });
    await fetch('/api/rows');
    await flush();
    expect(recorder.getState()).toMatchObject({ status: 'review', summary: { stopReason: 'max-size' } });
  });

  it.each([
    [{ network: 'everything' }, /capture.network/],
    [{ network: 'headers', bodies: {} }, /only applies/],
    [{ network: 'bodies', bodies: { maxBytes: 1_000_000 } }, /maxBytes/],
    [{ network: 'bodies', bodies: { contentTypes: ['image/*'] } }, /can only narrow/],
  ])('refuses a capture block that would widen the defaults: %j', (capture, message) => {
    const invalid: object = { capture };
    expect(() => createRecorder({ upload: createFakeTransport().upload, ...invalid })).toThrow(message);
  });

  it('tells the consent prompt that request content is recorded', async () => {
    let facts: PrivacyFacts | undefined;
    const ui: RecorderUi = {
      requestConsent: (context) => {
        facts = context.privacy;
        return Promise.resolve(false);
      },
      showIndicator: () => () => {},
      confirmUpload: () => Promise.resolve({ confirmed: false }),
    };
    const recorder = createRecorder({ upload: createFakeTransport().upload, ui, capture: { network: 'bodies' } });
    await recorder.request();
    expect(facts?.captures).toMatchObject({ network: true, networkBodies: true });
    expect(defaultRecorderMessages.consentPrivacy({ mode: 'masked', privacy: must(facts) })).toContain(
      'Request and response content is recorded with secrets removed.',
    );
  });
});
