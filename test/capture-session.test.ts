import { describe, expect, it } from 'vitest';

import { type CdpLike, type RecorderChunk, RecorderSession, normalizeConsole, normalizePerformance } from '../src/capture/session.ts';

type Handler = (params: Record<string, unknown>) => void;

/** A scripted Chrome DevTools connection: records every command, answers `Runtime.evaluate` from a queue. */
class FakeCdp implements CdpLike {
  readonly calls: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
  readonly handlers = new Map<string, Set<Handler>>();
  /** Answers to the next flush evaluations, in order; the last one repeats nothing (an empty page). */
  chunks: Array<RecorderChunk | Error | { exceptionDetails: unknown }> = [];
  /** When set, flush evaluations wait for it (to hold a pull in flight). */
  gate: Promise<void> | undefined;
  probe: unknown = { href: 'https://example.com/', running: true, flush: 'function' };
  probeFails = false;
  inFlight = 0;
  maxInFlight = 0;

  async send(method: string, params?: Record<string, unknown>) {
    this.calls.push({ method, params });
    if (method !== 'Runtime.evaluate') return {};
    const expression = String(params?.expression ?? '');
    if (!expression.includes('__REPLAYS_FLUSH__?.(')) {
      if (this.probeFails) throw new Error('context destroyed');
      return { result: { value: this.probe } };
    }
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      const next = this.chunks.shift();
      if (next instanceof Error) throw next;
      if (next && 'exceptionDetails' in next) return next;
      return { result: { value: next } };
    } finally {
      this.inFlight--;
    }
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, params: Record<string, unknown>) {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  flushes() {
    return this.calls.filter(
      (call) => call.method === 'Runtime.evaluate' && String(call.params?.expression).includes('__REPLAYS_FLUSH__?.('),
    );
  }
}

const events = (...timestamps: number[]) => timestamps.map((timestamp) => ({ type: 3, timestamp }));
const LONG_INTERVAL = { pullIntervalMs: 3_600_000 };

describe('RecorderSession.start', () => {
  it('enables the domains, registers the navigation binding and the recorder script, then listens for the binding', async () => {
    const cdp = new FakeCdp();
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    expect(cdp.calls.map((call) => call.method)).toEqual([
      'Runtime.enable',
      'Page.enable',
      'Runtime.addBinding',
      'Page.addScriptToEvaluateOnNewDocument',
    ]);
    expect(cdp.calls[2]!.params).toEqual({ name: '__replaysNavigationFlush' });
    const source = String(cdp.calls[3]!.params?.source);
    expect(source.length).toBeGreaterThan(1000);
    // The browser bundle is self-contained: rrweb is inlined, no module syntax is left.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(cdp.handlers.get('Runtime.bindingCalled')?.size).toBe(1);
    session.dispose();
    expect(cdp.handlers.get('Runtime.bindingCalled')?.size).toBe(0);
  });

  it('pulls on a timer', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [{ events: events(1000) }, { events: events(1100) }];
    const session = await RecorderSession.start(cdp, { pullIntervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    session.dispose();
    expect(cdp.flushes().length).toBeGreaterThanOrEqual(2);
    const count = cdp.flushes().length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cdp.flushes()).toHaveLength(count);
  });
});

describe('flush', () => {
  it('asks the page for what it buffered, a final flush with true', async () => {
    const cdp = new FakeCdp();
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await session.flush();
    await session.flush(true);
    session.dispose();
    expect(cdp.flushes().map((call) => [call.params?.expression, call.params?.returnByValue])).toEqual([
      ['window.__REPLAYS_FLUSH__?.()', true],
      ['window.__REPLAYS_FLUSH__?.(true)', true],
    ]);
  });

  it('never runs two pulls at once; a final flush requested meanwhile runs after the pull in flight', async () => {
    const cdp = new FakeCdp();
    let release!: () => void;
    cdp.gate = new Promise<void>((resolve) => (release = resolve));
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    const first = session.flush();
    const second = session.flush();
    const final = session.flush(true);
    expect(cdp.flushes()).toHaveLength(1);
    release();
    await Promise.all([first, second, final]);
    session.dispose();
    expect(cdp.maxInFlight).toBe(1);
    expect(cdp.flushes().map((call) => String(call.params?.expression).endsWith('(true)'))).toEqual([false, true]);
  });

  it('ignores a failing evaluation (a navigation replaced the page) and an evaluation that threw in the page', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [new Error('Execution context was destroyed'), { exceptionDetails: { text: 'boom' } }, { events: events(1000, 1100) }];
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await session.flush();
    await session.flush();
    await session.flush();
    const tracks = await session.stop();
    expect(tracks.events.map((event) => event.timestamp)).toEqual([1000, 1100]);
  });
});

describe('the navigation binding', () => {
  it('adds the chunk the page sent as it unloads', async () => {
    const cdp = new FakeCdp();
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    const chunk: RecorderChunk = {
      events: events(2000, 2100),
      console: [{ at: 2050, level: 'error', message: 'Boom' }],
      performance: [{ at: 2060, kind: 'first-contentful-paint', value: 60 }],
      performanceSupported: ['paint'],
    };
    cdp.emit('Runtime.bindingCalled', { name: '__replaysNavigationFlush', payload: JSON.stringify(chunk) });
    const tracks = await session.stop();
    expect(tracks.events).toHaveLength(2);
    expect(tracks.console).toEqual([{ at: 50, level: 'error', message: 'Boom' }]);
    expect(tracks.performance).toEqual({ supported: ['paint'], entries: [{ at: 60, kind: 'first-contentful-paint', value: 60 }] });
  });

  it('ignores other bindings, payloads that are not strings, and malformed JSON', async () => {
    const cdp = new FakeCdp();
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    const payload = JSON.stringify({ events: events(1, 2, 3) });
    cdp.emit('Runtime.bindingCalled', { name: 'someOtherBinding', payload });
    cdp.emit('Runtime.bindingCalled', { name: '__replaysNavigationFlush', payload: { events: [] } });
    cdp.emit('Runtime.bindingCalled', { name: '__replaysNavigationFlush', payload: '{not json' });
    await expect(session.stop()).rejects.toThrow('rrweb recorded fewer than two events');
  });

  it('stops listening once the session has stopped', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [{ events: events(1000, 1100) }];
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await session.stop();
    expect(cdp.handlers.get('Runtime.bindingCalled')?.size).toBe(0);
  });
});

describe('stop', () => {
  it('takes a final flush first, then returns every track on the timeline of the first event', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [
      { events: events(5000, 5200), console: [{ at: 5100, level: 'warn', message: 'Slow' }] },
      {
        events: events(5600),
        console: [{ at: 5500, level: 'error', message: 'Failed to load coupon' }],
        performance: [
          { at: 5300, kind: 'long-task', value: 74 },
          { at: 5100, kind: 'first-contentful-paint', value: 100 },
        ],
        performanceSupported: ['paint', 'longtask', 'not-a-type'],
      },
    ];
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await session.flush();
    const tracks = await session.stop();
    expect(cdp.flushes().map((call) => String(call.params?.expression).endsWith('(true)'))).toEqual([false, true]);
    expect(tracks.origin).toBe(5000);
    expect(tracks.duration).toBe(600);
    expect(tracks.console).toEqual([
      { at: 100, level: 'warn', message: 'Slow' },
      { at: 500, level: 'error', message: 'Failed to load coupon' },
    ]);
    expect(tracks.performance.supported).toEqual(['longtask', 'paint']);
    expect(tracks.performance.entries).toEqual([
      { at: 100, kind: 'first-contentful-paint', value: 100 },
      { at: 300, kind: 'long-task', value: 74 },
    ]);
  });

  it('sorts events by time and redacts URLs inside them', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [
      {
        events: [
          { type: 3, timestamp: 3000 },
          { type: 4, timestamp: 1000, data: { href: 'https://example.com/login?api_token=leaked&next=%2F', width: 800, height: 600 } },
        ],
      },
    ];
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    const tracks = await session.stop();
    expect(tracks.events.map((event) => event.timestamp)).toEqual([1000, 3000]);
    expect(JSON.stringify(tracks.events)).not.toContain('leaked');
    expect(JSON.stringify(tracks.events)).toContain('api_token=%5Bredacted%5D');
    expect(tracks.duration).toBe(2000);
  });

  it('reports at least 1 ms of duration', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [{ events: events(1000, 1000) }];
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    expect((await session.stop()).duration).toBe(1);
  });

  it('throws when fewer than two events were recorded, with what the page looked like', async () => {
    const cdp = new FakeCdp();
    cdp.chunks = [{ events: events(1000) }];
    cdp.probe = { href: 'https://example.com/', running: false, flush: 'undefined', error: 'recorder failed to start' };
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await expect(session.stop()).rejects.toThrow(
      'rrweb recorded fewer than two events ({"href":"https://example.com/","running":false,"flush":"undefined","error":"recorder failed to start"})',
    );
  });

  it('still throws when the page cannot be probed', async () => {
    const cdp = new FakeCdp();
    cdp.probeFails = true;
    const session = await RecorderSession.start(cdp, LONG_INTERVAL);
    await expect(session.stop()).rejects.toThrow('rrweb recorded fewer than two events ({"context":"unavailable"})');
  });
});

describe('dispose', () => {
  it('stops the timer and the listener without collecting anything', async () => {
    const cdp = new FakeCdp();
    const session = await RecorderSession.start(cdp, { pullIntervalMs: 10 });
    session.dispose();
    const count = cdp.flushes().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cdp.flushes()).toHaveLength(count);
    expect(cdp.handlers.get('Runtime.bindingCalled')?.size).toBe(0);
  });
});

describe('normalizeConsole', () => {
  it('puts entries on the replay clock, never before zero', () => {
    expect(normalizeConsole([{ at: 900, level: 'log', message: 'early' }], 1000)).toEqual([{ at: 0, level: 'log', message: 'early' }]);
    expect(normalizeConsole(undefined, 0)).toEqual([]);
  });

  it('maps unknown levels to log and keeps the known ones', () => {
    const levels = normalizeConsole(
      ['debug', 'info', 'log', 'warn', 'error', 'trace', 'verbose'].map((level) => ({ at: 1, level, message: level })),
      0,
    ).map((entry) => entry.level);
    expect(levels).toEqual(['debug', 'info', 'log', 'warn', 'error', 'log', 'log']);
  });

  it('truncates long messages to 20,000 characters', () => {
    const [entry] = normalizeConsole([{ at: 1, level: 'log', message: 'x'.repeat(30_000) }], 0);
    expect(entry!.message).toHaveLength(20_000);
  });

  it('redacts URLs in the message and in the url field', () => {
    const [entry] = normalizeConsole(
      [
        {
          at: 1,
          level: 'error',
          message: 'GET https://api.example.com/me?password=hunter2 failed',
          url: 'https://example.com/?api_token=secret',
        },
      ],
      0,
    );
    expect(entry!.message).toBe('GET https://api.example.com/me?password=%5Bredacted%5D failed');
    expect(entry!.url).toBe('https://example.com/?api_token=%5Bredacted%5D');
  });
});

describe('normalizePerformance', () => {
  it('keeps only known kinds with finite, non-negative values and known event types, ordered by time', () => {
    const entries = normalizePerformance(
      [
        { at: 500, kind: 'long-task', value: 80 },
        { at: 100, kind: 'largest-contentful-paint', value: 100 },
        { at: 200, kind: 'made-up', value: 1 },
        { at: 300, kind: 'long-task', value: -5 },
        { at: Number.NaN, kind: 'long-task', value: 5 },
        { at: 400, kind: 'long-task', value: Number.POSITIVE_INFINITY },
        { at: 450, kind: 'slow-interaction', value: 70, eventType: 'contextmenu' },
        { at: 460, kind: 'slow-interaction', value: 70, eventType: 'keydown' },
      ],
      0,
    );
    expect(entries).toEqual([
      { at: 100, kind: 'largest-contentful-paint', value: 100 },
      { at: 460, kind: 'slow-interaction', value: 70, eventType: 'keydown' },
      { at: 500, kind: 'long-task', value: 80 },
    ]);
  });

  it('honours a lower limit and never exceeds 500 entries', () => {
    const many = Array.from({ length: 700 }, (_, index) => ({ at: index, kind: 'long-task', value: 50 }));
    expect(normalizePerformance(many, 0, 3)).toHaveLength(3);
    expect(normalizePerformance(many, 0, 10_000)).toHaveLength(500);
    expect(normalizePerformance(many, 0, 0)).toHaveLength(0);
    expect(normalizePerformance(undefined, 0)).toEqual([]);
  });
});
