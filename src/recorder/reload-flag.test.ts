// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EARLY_GLOBAL, takeEarly } from './early-queue.ts';
import { observeType } from './observe.ts';
import { armReload, RELOAD_FLAG_KEY, RELOAD_FLAG_TTL_MS, takeReload } from './reload-flag.ts';

const NOW = 1_000_000;

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, EARLY_GLOBAL);
});

describe('reload flag', () => {
  it('round-trips the choice and marks it as from load', () => {
    armReload({ privacy: 'text-masked', performance: true, fromLoad: true }, NOW);
    expect(takeReload(NOW + 5_000)).toEqual({ privacy: 'text-masked', performance: true, fromLoad: true });
  });

  it('fires once: a second page load finds nothing', () => {
    armReload({ performance: true, fromLoad: true }, NOW);
    takeReload(NOW + 1_000);
    expect(takeReload(NOW + 2_000)).toBeUndefined();
  });

  it('ignores and removes a stale flag, so a failed resume cannot loop', () => {
    armReload({ performance: true, fromLoad: true }, NOW);
    expect(takeReload(NOW + RELOAD_FLAG_TTL_MS + 1)).toBeUndefined();
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toBeNull();
  });

  it('ignores a flag whose expiry is further away than the allowed window', () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, JSON.stringify({ exp: NOW + 10 * 60_000, choice: { performance: true } }));
    expect(takeReload(NOW)).toBeUndefined();
  });

  it('drops unknown or mistyped choice fields instead of trusting page-writable storage', () => {
    sessionStorage.setItem(
      RELOAD_FLAG_KEY,
      JSON.stringify({
        exp: NOW + 1_000,
        choice: { privacy: 'everything', profile: 'Bad Profile', networkBodies: 'yes', performance: true, extra: 1 },
      }),
    );
    expect(takeReload(NOW)).toEqual({ performance: true, fromLoad: true });
  });

  it('survives malformed storage', () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, '{nope');
    expect(takeReload(NOW)).toBeUndefined();
  });

  it('reports false when storage is blocked, so the recorder records on this page', () => {
    const storage = {
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(armReload({ performance: true }, NOW, storage)).toBe(false);
  });
});

function stub() {
  const seen: Record<string, unknown>[] = [];
  class Observer {
    static supportedEntryTypes = ['paint', 'event'];
    observe(options: Record<string, unknown>) {
      seen.push(options);
    }
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  return seen;
}

describe('buffered observation', () => {
  it('asks the browser for buffered entries when recording from load', () => {
    const seen = stub();
    observeType('paint', () => {}, true);
    expect(seen[0]).toMatchObject({ type: 'paint', buffered: true });
  });

  it('does not buffer an ordinary recording', () => {
    const seen = stub();
    observeType('paint', () => {}, false);
    expect(seen[0]).toMatchObject({ buffered: false });
  });

  it('hands over what the early entry queued, once, and does not buffer twice', () => {
    const seen = stub();
    const early = {
      paint: { observer: { takeRecords: () => [{ name: 'late' }], disconnect: vi.fn<() => void>() }, entries: [{ name: 'first' }] },
    };
    vi.stubGlobal(EARLY_GLOBAL, early);
    const handled: string[][] = [];
    observeType('paint', (entries) => handled.push(entries.map((entry) => entry.name)), true);
    expect(handled).toEqual([['first', 'late']]);
    expect(seen[0]).toMatchObject({ buffered: false });
  });

  it('lets a second consumer of the same type read the same early entries', () => {
    stub();
    vi.stubGlobal(EARLY_GLOBAL, { event: { observer: { takeRecords: () => [], disconnect: () => {} }, entries: [{ name: 'click' }] } });
    expect(takeEarly('event')).toHaveLength(1);
    expect(takeEarly('event')).toHaveLength(1);
  });
});
