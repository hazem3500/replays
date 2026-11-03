// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForReplayPaint } from '../src/client/hooks/replay-first-paint.ts';

const ignore = () => {};

function deferred() {
  let resolve = ignore;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: HTMLDivElement;
let replay: Document;
let abort: AbortController;
let frames: Map<number, FrameRequestCallback>;
function setup() {
  abort = new AbortController();
  root = document.createElement('div');
  const iframe = document.createElement('iframe');
  root.append(iframe);
  replay = document.implementation.createHTMLDocument('Replay');
  Object.defineProperty(replay, 'defaultView', { configurable: true, value: window });
  Object.defineProperty(iframe, 'contentDocument', { configurable: true, get: () => replay });
  frames = new Map();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
}

function cleanup() {
  abort.abort();
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

async function paint() {
  for (let turn = 0; turn < 16; turn += 1) {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(turn * 16);
    await Promise.resolve();
  }
}

describe('replay cover resource readiness', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('retains the cover until images decode and the replay fonts finish loading', async () => {
    const fonts = deferred();
    const decoding = deferred();
    let status = 'loading';
    Object.defineProperty(replay, 'fonts', {
      configurable: true,
      value: {
        ready: fonts.promise,
        get status() {
          return status;
        },
      },
    });
    const image = replay.createElement('img');
    let complete = false;
    Object.defineProperties(image, {
      complete: { get: () => complete },
      naturalWidth: { get: () => (complete ? 20 : 0) },
      decode: { value: () => decoding.promise },
    });
    replay.body.append(image);
    let ready = false;
    const waiting = waitForReplayPaint(root, abort.signal).then(() => {
      ready = true;
    });
    await paint();
    expect(ready).toBe(false);
    complete = true;
    image.dispatchEvent(new Event('load'));
    status = 'loaded';
    fonts.resolve();
    await paint();
    expect(ready).toBe(false);
    decoding.resolve();
    await paint();
    await waiting;
    expect(ready).toBe(true);
  });

  it('releases an image that fails to load instead of retaining its cover forever', async () => {
    const image = replay.createElement('img');
    let complete = false;
    Object.defineProperty(image, 'complete', { get: () => complete });
    replay.body.append(image);
    const waiting = waitForReplayPaint(root, abort.signal);
    await paint();
    complete = true;
    image.dispatchEvent(new Event('error'));
    await paint();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('cancels pending resources and paint callbacks when its mount is abandoned', async () => {
    const fonts = deferred();
    Object.defineProperty(replay, 'fonts', { configurable: true, value: { ready: fonts.promise, status: 'loading' } });
    const waiting = waitForReplayPaint(root, abort.signal);
    await paint();
    abort.abort();
    await waiting;
    expect(frames.size).toBe(0);
  });

  it('releases a resource that never produces either a load or error event at the render budget', async () => {
    vi.useFakeTimers();
    const image = replay.createElement('img');
    Object.defineProperty(image, 'complete', { get: () => false });
    replay.body.append(image);
    const waiting = waitForReplayPaint(root, abort.signal);
    await paint();
    await vi.advanceTimersByTimeAsync(4000);
    await waiting;
    expect(frames.size).toBe(0);
  });
});
