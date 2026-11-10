// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HANDOFF_CHANNEL, HANDOFF_VERSION, parseHandoffMessage } from './handoff-protocol.ts';
import { handoffUpload, HandoffUploadError, type HandoffEvent, type HandoffHost } from './handoff-upload.ts';

const REPLAYS = 'https://replays.dev.toggl.com';
const base = { channel: HANDOFF_CHANNEL, version: HANDOFF_VERSION };

function setup() {
  let listener: ((event: HandoffEvent) => void) | undefined;
  const popup = {
    closed: false,
    postMessage: vi.fn<(message: unknown, origin: string) => void>(),
    close: vi.fn<() => void>(() => void (popup.closed = true)),
  };
  const host: HandoffHost = {
    open: vi.fn<HandoffHost['open']>(() => popup),
    addEventListener: (_type, fn) => (listener = fn),
    removeEventListener: () => (listener = undefined),
  };
  const send = (data: unknown, origin = REPLAYS, source: unknown = popup) => listener?.({ data, origin, source });
  const sentId = () => {
    const sent = parseHandoffMessage(popup.postMessage.mock.calls[0]?.[0]);
    return sent?.type === 'bundle' ? sent.id : '';
  };
  return { host, popup, send, sentId, listening: () => listener !== undefined };
}

describe('handoffUpload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens the upload page, sends the bundle to the Replays origin only and resolves with the receipt', async () => {
    const t = setup();
    const result = handoffUpload({ replaysUrl: `${REPLAYS}/`, payload: '{"a":1}', host: t.host });
    expect(t.host.open).toHaveBeenCalledWith(`${REPLAYS}/upload`, expect.any(String), expect.not.stringContaining('noopener'));
    t.send({ ...base, type: 'ready' });
    expect(t.popup.postMessage).toHaveBeenCalledTimes(1);
    expect(t.popup.postMessage).toHaveBeenCalledWith({ ...base, type: 'bundle', id: t.sentId(), payload: '{"a":1}' }, REPLAYS);
    t.send({ ...base, type: 'receipt', id: t.sentId(), ok: true, replayId: 'issue-1', url: '/r/issue-1' });
    await expect(result).resolves.toEqual({ replayId: 'issue-1', url: `${REPLAYS}/r/issue-1` });
    expect(t.popup.close).toHaveBeenCalled();
    expect(t.listening()).toBe(false);
  });

  it('ignores messages from another origin or another window, and never sends the bundle to them', async () => {
    const t = setup();
    const result = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host, readyTimeoutMs: 1000 });
    t.send({ ...base, type: 'ready' }, 'https://evil.example');
    t.send({ ...base, type: 'ready' }, REPLAYS, {});
    t.send({ ...base, type: 'ready' }, 'https://replays.dev.toggl.com.evil.example');
    expect(t.popup.postMessage).not.toHaveBeenCalled();
    const settled = result.catch((error: unknown) => error);
    const matcher_settled = { kind: 'timeout' };
    await vi.advanceTimersByTimeAsync(1001);
    expect(await settled).toMatchObject(matcher_settled);
  });

  it('ignores a receipt for another handoff or from a spoofed origin', async () => {
    const t = setup();
    const result = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host, uploadTimeoutMs: 1000 });
    t.send({ ...base, type: 'ready' });
    const ok = { ...base, type: 'receipt', ok: true, replayId: 'issue-1' };
    t.send({ ...ok, id: 'f'.repeat(32) });
    t.send({ ...ok, id: t.sentId() }, 'https://evil.example');
    const settled = result.catch((error: unknown) => error);
    const matcher_settled = { kind: 'timeout' };
    await vi.advanceTimersByTimeAsync(1001);
    expect(await settled).toMatchObject(matcher_settled);
  });

  it('reports an upload Replays refused', async () => {
    const t = setup();
    const result = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host });
    t.send({ ...base, type: 'ready' });
    t.send({ ...base, type: 'receipt', id: t.sentId(), ok: false, status: 413 });
    await expect(result).rejects.toMatchObject({ kind: 'rejected', status: 413 });
  });

  it('fails when the person closes the window first', async () => {
    const t = setup();
    const result = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host, closedPollMs: 100 });
    const settled = result.catch((error: unknown) => error);
    const matcher_settled = { kind: 'closed' };
    t.popup.closed = true;
    await vi.advanceTimersByTimeAsync(150);
    expect(await settled).toMatchObject(matcher_settled);
    expect(t.popup.close).not.toHaveBeenCalled();
  });
});

describe('handoffUpload limits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('times out when the page never gets ready, and again when no receipt comes', async () => {
    const first = setup();
    const waiting = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: first.host, readyTimeoutMs: 500 });
    const ready = waiting.catch((error: unknown) => error);
    const matcher_ready = { kind: 'timeout', message: 'The Replays window did not get ready in time.' };
    await vi.advanceTimersByTimeAsync(501);
    expect(await ready).toMatchObject(matcher_ready);
    expect(first.popup.close).toHaveBeenCalled();

    const second = setup();
    const sending = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: second.host, uploadTimeoutMs: 500 });
    second.send({ ...base, type: 'ready' });
    const answer = sending.catch((error: unknown) => error);
    const matcher_answer = { kind: 'timeout', message: 'Toggl Replays did not answer in time.' };
    await vi.advanceTimersByTimeAsync(501);
    expect(await answer).toMatchObject(matcher_answer);
  });

  it('refuses a payload over the cap before opening a window', async () => {
    const t = setup();
    await expect(handoffUpload({ replaysUrl: REPLAYS, payload: 'xxxx', maxChars: 3, host: t.host })).rejects.toMatchObject({
      kind: 'too-large',
    });
    expect(t.host.open).not.toHaveBeenCalled();
  });

  it('reports a blocked window', async () => {
    const t = setup();
    t.host.open = vi.fn<HandoffHost['open']>(() => null);
    await expect(handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host })).rejects.toBeInstanceOf(HandoffUploadError);
  });

  it('closes the window and stops listening when cancelled', async () => {
    const t = setup();
    const controller = new AbortController();
    const result = handoffUpload({ replaysUrl: REPLAYS, payload: 'x', host: t.host, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ kind: 'aborted' });
    expect(t.popup.close).toHaveBeenCalled();
    expect(t.listening()).toBe(false);
  });
});
