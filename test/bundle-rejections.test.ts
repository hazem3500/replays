import { describe, expect, it } from 'vitest';

import { assertReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const frame = { at: 100, duration: 120, blockingDuration: 70, renderStart: 100, styleAndLayoutStart: 110, scripts: [] };
const interaction = { at: 100, interactionId: 3, eventType: 'click', duration: 200, inputDelay: 40, processing: 120, presentation: 40 };
const withTrack = (extra: object) => ({ ...replay(), performance: { supported: ['long-animation-frame'], entries: [], ...extra } });

describe('long frame and interaction tracks', () => {
  it('accepts a bundle without them, as every older bundle is', () => {
    expect(() => assertReplayBundle(withTrack({}))).not.toThrow();
  });

  it('accepts frames and interactions linked to them', () => {
    const track = { longFrames: [frame], interactions: [{ ...interaction, frame: 0, step: 0, target: { tag: 'button', role: 'button' } }] };
    expect(() => assertReplayBundle(withTrack(track))).not.toThrow();
  });

  it.each<[string, object]>([
    ['more than 300 frames', { longFrames: Array.from({ length: 301 }, () => frame) }],
    ['more than three scripts', { longFrames: [{ ...frame, scripts: Array.from({ length: 4 }, () => ({})) }] }],
    ['more than 200 interactions', { interactions: Array.from({ length: 201 }, () => interaction) }],
    ['a negative phase', { interactions: [{ ...interaction, processing: -1 }] }],
    ['a frame link past the list', { longFrames: [frame], interactions: [{ ...interaction, frame: 1 }] }],
  ])('rejects %s', (_name, extra) => {
    expect(() => assertReplayBundle(withTrack(extra))).toThrow(/Invalid/);
  });
});

describe('bundle rejection contract', () => {
  it('accepts the canonical bundle', () => {
    expect(() => assertReplayBundle(replay())).not.toThrow();
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['array', []],
    ['missing meta', { ...replay(), meta: undefined }],
    ['invalid id', { ...replay(), meta: { ...replay().meta, id: '../private' } }],
    ['title type', { ...replay(), meta: { ...replay().meta, title: 3 } }],
    ['unsupported version', { ...replay(), meta: { ...replay().meta, version: 2 } }],
    ...[-1, NaN, Infinity].map((duration): [string, unknown] => [
      `duration ${duration}`,
      { ...replay(), meta: { ...replay().meta, duration } },
    ]),
    ['source', { ...replay(), meta: { ...replay().meta, source: 'unknown' } }],
    ['tags', { ...replay(), meta: { ...replay().meta, tags: ['Uppercase'] } }],
    ['profile', { ...replay(), meta: { ...replay().meta, profile: 'Not a profile' } }],
    ['events', { ...replay(), events: [{}] }],
    ['console', { ...replay(), console: {} }],
    ['network', { ...replay(), network: null }],
    ['steps', { ...replay(), steps: 'steps' }],
    ['context', { ...replay(), context: { version: 2 } }],
    ['suite id', { ...replay(), suiteRun: { suiteId: '../suite', runId: 'run' } }],
    ['run id', { ...replay(), suiteRun: { suiteId: 'suite', runId: 'bad/run' } }],
    ['suite fields', { ...replay(), suiteRun: { suiteId: 'suite', runId: 'run', extra: true } }],
  ])('rejects %s', (_name, value) => {
    expect(() => assertReplayBundle(value)).toThrow(/replay|rrweb/);
  });
});
