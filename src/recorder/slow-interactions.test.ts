// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { captureInteractions, describeTarget, linkInteractions } from './slow-interactions.ts';

const privacy = (maskAllText: boolean): RecorderPrivacy =>
  ({
    sanitize: true,
    maskAllText,
    textMasked: () => maskAllText,
    checkSelectors: () => {},
    rrwebOptions: () => ({ blockSelector: '[data-replay-block]' }),
    facts: () => ({}) as never,
  }) as RecorderPrivacy;

function button(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Element;
}

describe('interaction target description', () => {
  it('names a visible button with its role and a name cut to 40 characters', () => {
    const target = describeTarget(button(`<button>${'Save everything now '.repeat(5)}</button>`), privacy(false));
    expect(target?.tag).toBe('button');
    expect(target?.role).toBe('button');
    expect(target?.name?.length).toBeLessThanOrEqual(40);
  });

  it('keeps only tag and role when text is masked', () => {
    expect(describeTarget(button('<button aria-label="Pay Jane Doe">Pay</button>'), privacy(true))).toEqual({ tag: 'button', role: 'button' });
  });

  it('keeps only tag and role inside a blocked region', () => {
    const el = button('<div data-replay-block><button>Secret</button></div>').querySelector('button');
    expect(describeTarget(el, privacy(false))).toEqual({ tag: 'button', role: 'button' });
  });

  it('never uses a field value as the name', () => {
    const target = describeTarget(button('<input value="hunter2" aria-label="Password">'), privacy(false));
    expect(JSON.stringify(target)).not.toContain('hunter2');
  });
});

const entry = (over: object) => ({
  name: 'click',
  interactionId: 7,
  startTime: 1000,
  duration: 200,
  processingStart: 1040,
  processingEnd: 1160,
  target: null,
  ...over,
});

function setup() {
  const state: { receive?: PerformanceObserverCallback; options?: unknown } = {};
  class Observer {
    static supportedEntryTypes = ['event'];
    constructor(callback: PerformanceObserverCallback) {
      state.receive = callback;
    }
    observe(options: unknown) {
      state.options = options;
    }
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const track: ReplayPerformanceTrack = { supported: [], entries: [] };
  const stop = captureInteractions(track, () => {}, privacy(false), () => 2);
  const deliver = (entries: object[]) =>
    state.receive?.({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
  return { state, track, stop, deliver };
}

describe('interaction capture', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('observes with a 16 ms threshold', () => {
    expect(setup().state.options).toMatchObject({ type: 'event', durationThreshold: 16 });
  });

  it('groups the events of one tap into a single interaction with the slowest event', () => {
    const { track, deliver } = setup();
    deliver([entry({ name: 'pointerdown', duration: 24, processingEnd: 1050 }), entry({}), entry({ name: 'pointerup', duration: 32 })]);
    expect(track.interactions).toHaveLength(1);
    expect(track.interactions?.[0]).toMatchObject({ eventType: 'click', inputDelay: 40, processing: 120, presentation: 40, step: 2 });
  });

  it('ignores hovers without an interaction id and events under 16 ms', () => {
    const { track, deliver } = setup();
    deliver([entry({ interactionId: 0 }), entry({ interactionId: 8, duration: 8 })]);
    expect(track.interactions).toBeUndefined();
  });

  it('stops at 200 interactions', () => {
    const { track, deliver } = setup();
    deliver(Array.from({ length: 260 }, (_, index) => entry({ interactionId: index + 1 })));
    expect(track.interactions).toHaveLength(200);
  });

  it('links an interaction to the long frame it overlaps', () => {
    const { track, deliver } = setup();
    deliver([entry({})]);
    const at = track.interactions?.[0]?.at ?? 0;
    track.longFrames = [
      { at: at - 5000, duration: 100, blockingDuration: 50, renderStart: 0, styleAndLayoutStart: 0, scripts: [] },
      { at: at + 20, duration: 150, blockingDuration: 100, renderStart: 0, styleAndLayoutStart: 0, scripts: [] },
    ];
    linkInteractions(track);
    expect(track.interactions?.[0]?.frame).toBe(1);
  });
});
