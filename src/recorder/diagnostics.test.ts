// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { capturePerformance } from './diagnostics.ts';
import type { ReplayPerformanceEntry } from '../shared/replay.ts';

afterEach(() => vi.unstubAllGlobals());

it('bounds numeric layout shifts and accounts for their retained bytes', () => {
  let receive: PerformanceObserverCallback | undefined;
  const disconnect = vi.fn<() => void>();
  class Observer {
    static supportedEntryTypes = ['layout-shift'];
    constructor(callback: PerformanceObserverCallback) {
      receive = callback;
    }
    observe() {}
    disconnect = disconnect;
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const grow = vi.fn<(bytes: number) => void>();
  const diagnostic = capturePerformance(() => {}, grow);
  const entries = Array.from({ length: 700 }, () => ({ startTime: 100, value: 0.1, hadRecentInput: false }));
  const list = { getEntries: () => entries } as unknown as PerformanceObserverEntryList;
  receive?.(list, {} as PerformanceObserver);
  expect(diagnostic.track.layoutShifts).toHaveLength(500);
  expect(grow).toHaveBeenCalledTimes(500);
  diagnostic.stop();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('rejects late observer callbacks after capture stops', () => {
  let receive: PerformanceObserverCallback | undefined;
  class Observer {
    static supportedEntryTypes = ['longtask'];
    constructor(callback: PerformanceObserverCallback) {
      receive = callback;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const entry = vi.fn<(value: ReplayPerformanceEntry) => void>();
  const diagnostic = capturePerformance(entry);
  diagnostic.stop();
  receive?.(
    { getEntries: () => [{ startTime: 100, duration: 200 }] } as unknown as PerformanceObserverEntryList,
    {} as PerformanceObserver,
  );
  expect(entry).not.toHaveBeenCalled();
});
