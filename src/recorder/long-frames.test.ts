// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { interactionBreakdown } from '../shared/interaction-timing.ts';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';
import { captureLongFrames, createLongFrameFilter, scriptOrigin, trimScripts } from './long-frames.ts';

function stubObserver(types: string[]) {
  const state: { receive?: PerformanceObserverCallback } = {};
  class Observer {
    static supportedEntryTypes = types;
    constructor(callback: PerformanceObserverCallback) {
      state.receive = callback;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  return state;
}

const frame = (startTime: number, duration = 120) => ({
  startTime,
  duration,
  blockingDuration: 70,
  renderStart: startTime + 100,
  styleAndLayoutStart: startTime + 110,
  scripts: [],
});

describe('interaction breakdown', () => {
  it('splits an interaction into input delay, processing and presentation that sum to its duration', () => {
    const parts = interactionBreakdown({ startTime: 1000, duration: 240, processingStart: 1040, processingEnd: 1200 });
    expect(parts).toEqual({ inputDelay: 40, processing: 160, presentation: 40 });
  });

  it('never reports a negative phase when the browser rounds processing past the frame', () => {
    const parts = interactionBreakdown({ startTime: 1000, duration: 100, processingStart: 1000, processingEnd: 1130 });
    expect(parts.presentation).toBe(0);
  });
});

describe('long animation frame scripts', () => {
  it('keeps the three longest scripts, longest first', () => {
    const scripts = [10, 90, 40, 70, 20].map((duration) => ({ duration, sourceURL: 'https://a.test/x.js', invoker: 'i', invokerType: 't' }));
    expect(trimScripts(scripts).map((script) => script.duration)).toEqual([90, 70, 40]);
  });

  it('drops the query, hash and credentials from a script URL', () => {
    expect(scriptOrigin('https://user:pw@a.test/app/main.js?token=abc#frag')).toBe('https://a.test/app/main.js');
  });

  it('keeps only the scheme of inline and blob sources', () => {
    expect(scriptOrigin('blob:https://a.test/1234-5678')).toBe('blob:');
  });

  it('strips the query from an invoker that is a URL', () => {
    const [script] = trimScripts([{ duration: 60, invoker: 'https://a.test/h.js?session=secret', invokerType: 'event-listener' }]);
    expect(script?.invoker).toBe('https://a.test/h.js');
  });

  it('redacts opaque tokens in function names', () => {
    const [script] = trimScripts([{ duration: 60, sourceFunctionName: 'a'.repeat(40) }]);
    expect(script?.sourceFunctionName).toBe('[redacted]');
  });
});

describe('long animation frame caps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores frames at or under 50 ms', () => {
    const keep = createLongFrameFilter();
    expect(keep({ startTime: 10, duration: 50 } as PerformanceEntry)).toBe(false);
  });

  it('keeps at most 30 frames in one minute and resumes the next minute', () => {
    const keep = createLongFrameFilter();
    const kept = Array.from({ length: 40 }, (_, index) => keep({ startTime: index * 100, duration: 80 } as PerformanceEntry));
    expect(kept.filter(Boolean)).toHaveLength(30);
    expect(keep({ startTime: 61_000, duration: 80 } as PerformanceEntry)).toBe(true);
  });

  it('never stores more than 300 frames in total', () => {
    const state = stubObserver(['long-animation-frame']);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    captureLongFrames(track, () => {});
    const entries = Array.from({ length: 400 }, (_, index) => frame(index * 60_000));
    state.receive?.({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
    expect(track.longFrames).toHaveLength(300);
    expect(track.supported).toContain('long-animation-frame');
  });

  it('stores nothing where the browser lacks the entry type', () => {
    stubObserver(['longtask']);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    captureLongFrames(track, () => {});
    expect(track.longFrames).toBeUndefined();
  });
});
