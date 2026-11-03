// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReplayPlayback, type ReplayPlayback } from '../src/client/playback/index.ts';
import { applyEdits, assertReplayBundle, assertReplayEdits, compileRedaction, redactText, type ReplayBundle } from '../src/shared/model.ts';

const owned: ReplayPlayback[] = [];

function recording(id = 'consumer-one', text = 'Recorded example'): ReplayBundle {
  return {
    meta: {
      id,
      title: 'Consumer recording',
      url: 'https://example.com/',
      capturedAt: '2026-11-02T00:00:00.000Z',
      duration: 1000,
      viewport: { width: 800, height: 600 },
      eventCount: 2,
      version: 1,
    },
    events: [
      { type: 4, timestamp: 1000, data: { href: 'https://example.com/', width: 800, height: 600 } },
      {
        type: 2,
        timestamp: 2000,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [
              {
                type: 2,
                id: 2,
                tagName: 'html',
                attributes: {},
                childNodes: [
                  { type: 2, id: 3, tagName: 'head', attributes: {}, childNodes: [] },
                  { type: 2, id: 4, tagName: 'body', attributes: {}, childNodes: [{ type: 3, id: 5, textContent: text }] },
                ],
              },
            ],
          },
          initialOffset: { top: 0, left: 0 },
        },
      },
    ],
    steps: [{ at: 0, kind: 'open', label: 'Open the example' }],
    console: [],
    network: [],
  };
}

function playback(bundle?: ReplayBundle) {
  const instance = createReplayPlayback(bundle);
  owned.push(instance);
  return instance;
}

describe('independent playback consumer', () => {
  afterEach(() => {
    for (const instance of owned.splice(0)) instance.destroy();
  });

  it('keeps independent playheads and settings without a React provider or application store', () => {
    const first = playback(recording());
    const second = playback(recording('consumer-two'));
    first.actions.seek(800);
    first.actions.setSpeed(2);
    first.actions.setSkipInactive(false);
    expect(first.getSnapshot()).toMatchObject({ time: 800, state: { speed: 2, skipInactive: false } });
    expect(second.getSnapshot()).toMatchObject({ time: 0, state: { speed: 1, skipInactive: true } });
    expect(first.getSnapshot()).toBe(first.getSnapshot());
  });

  it('rejects invalid replacement data without losing the current recording or playhead', () => {
    const instance = playback(recording());
    instance.actions.seek(400);
    const before = instance.getSnapshot();
    const invalid = recording('consumer-two');
    invalid.meta.duration = -1;
    expect(() => instance.load(invalid)).toThrow('replay duration is invalid');
    expect(instance.getSnapshot()).toBe(before);
    instance.load(recording('consumer-three'));
    expect(instance.getSnapshot()).toMatchObject({ phase: 'ready', time: 0, bundle: { meta: { id: 'consumer-three' } } });
  });

  it('notifies until unsubscribe and makes destruction terminal and idempotent', () => {
    const instance = playback();
    const observe = vi.fn<() => void>();
    const unsubscribe = instance.subscribe(observe);
    instance.load(recording());
    instance.actions.seek(300);
    expect(observe).toHaveBeenCalledTimes(2);
    unsubscribe();
    instance.actions.seek(600);
    expect(observe).toHaveBeenCalledTimes(2);
    instance.destroy();
    const final = instance.getSnapshot();
    instance.destroy();
    expect(instance.getSnapshot()).toBe(final);
    expect(final.phase).toBe('destroyed');
    expect(() => instance.actions.seek(0)).toThrow('Playback has been destroyed');
    expect(() => instance.load(recording())).toThrow('Playback has been destroyed');
  });
});

describe('portable model consumer', () => {
  it('validates and applies edits without mutating the source recording', () => {
    const bundle = recording();
    assertReplayBundle(bundle);
    const original = structuredClone(bundle);
    const edits = { version: 1, cuts: [], trim: { start: 100, end: 900 } };
    assertReplayEdits(edits, bundle.meta.duration);
    expect(applyEdits(bundle, edits).bundle.meta.duration).toBe(800);
    expect(bundle).toEqual(original);
  });

  it('uses additive shared redaction rules without depending on a server module', () => {
    const privacy = compileRedaction({ text: [{ pattern: 'private-project' }] });
    expect(redactText('Open private-project', privacy)).toBe('Open [redacted]');
  });
});
