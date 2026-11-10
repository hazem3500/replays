// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_INTERACTIONS as SHARED_INTERACTIONS, MAX_LONG_FRAMES as SHARED_FRAMES } from '../shared/interaction-timing.ts';
import { interactionBreakdown, MAX_INTERACTIONS, MAX_LONG_FRAMES } from './interaction-math.ts';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';
import { captureLongFrames, createLongFrameFilter, scriptOrigin, trimScripts } from './long-frames.ts';

function stubObserver(types: string[]) {
  const state: { receive?: PerformanceObserverCallback; observer?: PerformanceObserver; pending?: PerformanceEntry[] } = {};
  class Observer {
    static supportedEntryTypes = types;
    constructor(callback: PerformanceObserverCallback) {
      state.receive = callback;
      state.observer = this;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return state.pending ?? [];
    }
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  return state;
}

const timed = (startTime: number, duration: number): PerformanceEntry => ({
  name: 'frame',
  entryType: 'long-animation-frame',
  startTime,
  duration,
  toJSON: () => ({}),
});

const listOf = (entries: PerformanceEntry[]): PerformanceObserverEntryList => ({
  getEntries: () => entries,
  getEntriesByName: () => entries,
  getEntriesByType: () => entries,
});

const frame = (startTime: number, duration = 120) => ({
  ...timed(startTime, duration),
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
    expect(parts).toEqual({ inputDelay: 0, processing: 100, presentation: 0 });
    expect(parts.inputDelay + parts.processing + parts.presentation).toBe(100);
  });

  it('keeps the parts inside the interaction when processing starts before it or after its end', () => {
    expect(interactionBreakdown({ startTime: 1000, duration: 100, processingStart: 990, processingEnd: 1050 })).toEqual({
      inputDelay: 0,
      processing: 50,
      presentation: 50,
    });
    expect(interactionBreakdown({ startTime: 1000, duration: 100, processingStart: 1120, processingEnd: 1130 })).toEqual({
      inputDelay: 100,
      processing: 0,
      presentation: 0,
    });
  });
});

describe('long animation frame scripts', () => {
  it('keeps the three longest scripts, longest first', () => {
    const scripts = [10, 90, 40, 70, 20].map((duration) => ({
      duration,
      sourceURL: 'https://a.test/x.js',
      invoker: 'i',
      invokerType: 't',
    }));
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
    expect(keep(timed(10, 50))).toBe(false);
  });

  it('keeps at most 30 frames in one minute and resumes the next minute', () => {
    const keep = createLongFrameFilter();
    const kept = Array.from({ length: 40 }, (_, index) => keep(timed(index * 100, 80)));
    expect(kept.filter(Boolean)).toHaveLength(30);
    expect(keep(timed(61_000, 80))).toBe(true);
  });

  it('never stores more than 300 frames in total', () => {
    const state = stubObserver(['long-animation-frame']);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    captureLongFrames(track, () => {});
    const entries = Array.from({ length: 400 }, (_, index) => frame(index * 60_000));
    if (state.receive && state.observer) state.receive(listOf(entries), state.observer);
    expect(track.longFrames).toHaveLength(300);
    expect(track.supported).toContain('long-animation-frame');
  });

  it('keeps a frame the browser queued but had not delivered when recording stops', () => {
    const state = stubObserver(['long-animation-frame']);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    const onFrame = vi.fn<() => void>();
    const stop = captureLongFrames(track, () => {}, onFrame);
    state.pending = [frame(5_000)];
    stop();
    expect(track.longFrames).toHaveLength(1);
    expect(onFrame).toHaveBeenCalled();
  });

  it('stores nothing where the browser lacks the entry type', () => {
    stubObserver(['longtask']);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    captureLongFrames(track, () => {});
    expect(track.longFrames).toBeUndefined();
  });
});

describe('recorder and viewer caps', () => {
  it('stay equal, because the recorder bundle cannot import the shared copy', () => {
    expect([MAX_LONG_FRAMES, MAX_INTERACTIONS]).toEqual([SHARED_FRAMES, SHARED_INTERACTIONS]);
  });
});
