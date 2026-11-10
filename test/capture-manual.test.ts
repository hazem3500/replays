import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { capture, parseArgs, parseMaxDuration } from '../src/capture/capture.ts';
import { CAPTURE_USAGE } from '../src/capture/capture-usage.ts';
import type { CaptureDriver } from '../src/capture/drivers/types.ts';
import { waitForManualStop } from '../src/capture/manual.ts';
import { deriveManualSteps } from '../src/capture/manual-steps.ts';
import { recorderScript, type CdpLike, type RecorderChunk } from '../src/capture/session.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';

const manual = ['--url', 'https://example.com', '--headed', '--manual'];

describe('--manual arguments', () => {
  it('needs --headed', async () => {
    await expect(parseArgs(['--url', 'https://example.com', '--manual'])).rejects.toThrow('--manual requires --headed');
  });

  it('cannot be combined with --steps', async () => {
    await expect(parseArgs([...manual, '--steps', '[]'])).rejects.toThrow('--manual cannot be combined with --steps');
  });

  it('needs the playwright driver', async () => {
    await expect(parseArgs([...manual, '--driver', 'agent-browser'])).rejects.toThrow('--manual needs the playwright driver');
  });

  it('takes --max-duration only with --manual', async () => {
    await expect(parseArgs(['--url', 'https://example.com', '--output', '/tmp/x', '--max-duration', '30'])).rejects.toThrow(
      '--max-duration requires --manual',
    );
  });

  it('makes --output optional, defaulting to a directory named after the id, and keeps the other options', async () => {
    const args = await parseArgs([...manual, '--id', 'my-take', '--viewport', '1000x700', '--network', 'off']);
    expect(args.manual).toEqual({ maxDurationMs: 180_000 });
    expect(args.output.endsWith('/my-take')).toBe(true);
    expect(args.steps).toEqual([]);
    expect(args.viewport).toEqual({ width: 1000, height: 700 });
    expect(args.network).toBe('off');
  });

  it('still requires --output without --manual', async () => {
    await expect(parseArgs(['--url', 'https://example.com'])).rejects.toThrow('required: --output <directory>');
  });

  it('reads --max-duration as seconds, with an s or m suffix, up to ten minutes', () => {
    expect(parseMaxDuration()).toBe(180_000);
    expect(parseMaxDuration('90')).toBe(90_000);
    expect(parseMaxDuration('90s')).toBe(90_000);
    expect(parseMaxDuration('2m')).toBe(120_000);
    for (const bad of ['0', '601', '11m', 'soon', '-5', '']) expect(() => parseMaxDuration(bad)).toThrow('--max-duration must be');
  });

  it('is described in the capture usage', () => {
    expect(CAPTURE_USAGE).toContain('--manual');
    expect(CAPTURE_USAGE).toContain('--max-duration');
  });
});

function stdinTty(isTTY: boolean) {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

describe('stopping a manual recording', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const never = new Promise<void>(() => {});

  it('stops on a line from a terminal', async () => {
    const stdin = stdinTty(true);
    const { reason, release } = waitForManualStop({ closed: never, maxDurationMs: 60_000, stdin });
    stdin.write('\n');
    await expect(reason).resolves.toBe('enter');
    release();
  });

  it('never reads stdin that is not a terminal', async () => {
    const stdin = stdinTty(false);
    const read = vi.spyOn(stdin, 'on');
    const closed = Promise.resolve();
    const { reason, release } = waitForManualStop({ closed, maxDurationMs: 60_000, stdin });
    stdin.write('\n');
    await expect(reason).resolves.toBe('closed');
    expect(read).not.toHaveBeenCalled();
    release();
  });

  it('stops when the page or window closes', async () => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const { reason, release } = waitForManualStop({ closed, maxDurationMs: 60_000 });
    close();
    await expect(reason).resolves.toBe('closed');
    release();
  });

  it('stops on SIGINT and SIGTERM, and a second signal aborts', async () => {
    for (const name of ['SIGINT', 'SIGTERM']) {
      const signals = new EventEmitter();
      const abort = vi.fn<() => void>();
      const { reason, release } = waitForManualStop({ closed: never, maxDurationMs: 60_000, signals, abort });
      signals.emit(name);
      await expect(reason).resolves.toBe('signal');
      expect(abort).not.toHaveBeenCalled();
      signals.emit(name);
      expect(abort).toHaveBeenCalledTimes(1);
      release();
      expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM')).toBe(0);
    }
  });

  it('stops at the duration limit and ticks once a second until then', async () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const { reason, release } = waitForManualStop({
      closed: never,
      maxDurationMs: 3500,
      onTick: (ms) => ticks.push(ms),
      now: () => Date.now(),
    });
    await vi.advanceTimersByTimeAsync(3600);
    await expect(reason).resolves.toBe('max-duration');
    expect(ticks).toEqual([1000, 2000, 3000]);
    release();
  });
});

const step = (at: number, label: string, kind = 'click') => ({ at, kind, label, auto: true as const });

describe('steps of a manual recording', () => {
  it('keeps the in-page steps in time order', () => {
    expect(deriveManualSteps([step(300, 'Clicked “Save”'), step(100, 'Focused “Email”')], []).map((s) => s.label)).toEqual([
      'Focused “Email”',
      'Clicked “Save”',
    ]);
  });

  it('folds a page load right after a click into the click', () => {
    const steps = deriveManualSteps([step(1000, 'Clicked “Pricing”')], [{ at: 1400, url: 'https://example.com/pricing' }]);
    expect(steps.map((s) => s.label)).toEqual(['Opened “Pricing”']);
  });

  it('adds a step for a page load nobody clicked to', () => {
    const steps = deriveManualSteps([step(1000, 'Clicked “Pricing”')], [{ at: 9000, url: 'https://example.com/docs/getting-started?x=1' }]);
    expect(steps.map((s) => [s.kind, s.label])).toEqual([
      ['click', 'Clicked “Pricing”'],
      ['navigate', 'Opened Getting started'],
    ]);
    expect(JSON.stringify(steps)).not.toContain('x=1');
  });

  it('names the home page, and uses one click for only one load', () => {
    const steps = deriveManualSteps(
      [step(1000, 'Clicked button')],
      [
        { at: 1200, url: 'https://example.com/' },
        { at: 1300, url: 'https://example.com/a' },
      ],
    );
    expect(steps.map((s) => s.label)).toEqual(['Opened home', 'Opened A']);
  });

  it('asks the page for steps only in a manual recording', () => {
    expect(recorderScript('x();', {}, { steps: true })).toContain('__REPLAYS_STEPS__=true');
    expect(recorderScript('x();')).not.toContain('__REPLAYS_STEPS__');
  });
});

class FakeCdp implements CdpLike {
  private served = false;
  private readonly chunk: RecorderChunk;

  constructor(chunk: RecorderChunk) {
    this.chunk = chunk;
  }

  send(method: string, params?: Record<string, unknown>) {
    if (method !== 'Runtime.evaluate' || !String(params?.expression).includes('__REPLAYS_FLUSH__?.(')) return Promise.resolve({});
    const value = this.served ? {} : this.chunk;
    this.served = true;
    return Promise.resolve({ result: { value } });
  }

  on() {}

  off() {}
}

async function run(stop: (close: () => void) => void, hooks: Parameters<typeof capture>[2] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replays-manual-'));
  try {
    const origin = Date.now() + 10_000;
    const cdp = new FakeCdp({
      events: [
        { type: 2, timestamp: origin },
        { type: 3, timestamp: origin + 2000 },
      ],
      steps: [{ at: origin + 500, kind: 'click', label: 'Clicked “Save”', auto: true }],
    });
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const waits: number[] = [];
    const driver: CaptureDriver = {
      name: 'fake',
      launch: ({ harPath }) => writeFile(harPath, JSON.stringify({ log: { entries: [] } })).then(() => cdp),
      closed: () => closed,
      open: () => Promise.resolve(),
      step: () => Promise.reject(new Error('a manual recording runs no steps')),
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      finish: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const args = await parseArgs([...manual, '--output', join(root, 'out'), '--max-duration', '30']);
    const result = await capture({ ...args, steps: [{ kind: 'click', selector: 'a' }] }, driver, {
      ...hooks,
      onRecording: () => stop(close),
    });
    const parsed: unknown = JSON.parse(await readFile(result.replayPath, 'utf8'));
    assertReplayBundle(parsed);
    return { result, bundle: parsed, waits };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('a manual capture', () => {
  it('saves the steps the page named, after the open step, when the window is closed', async () => {
    const { result, bundle, waits } = await run((close) => close());
    expect(result.stoppedBy).toBe('closed');
    expect(bundle.steps.map(({ at, label }) => [at, label])).toEqual([
      [0, 'Open example.com'],
      [500, 'Clicked “Save”'],
    ]);
    expect(waits).toEqual([700]);
  });

  it('settles before saving when stopped from the terminal', async () => {
    const stdin = stdinTty(true);
    const { result, waits } = await run(() => stdin.write('\n'), { stdin });
    expect(result.stoppedBy).toBe('enter');
    expect(waits).toEqual([700, 900]);
  });

  it('stops on a signal', async () => {
    const signals = new EventEmitter();
    const { result } = await run(() => signals.emit('SIGTERM'), { signals });
    expect(result.stoppedBy).toBe('signal');
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
