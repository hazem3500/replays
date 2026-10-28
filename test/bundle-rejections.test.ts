import { describe, expect, it } from 'vitest';

import { assertReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

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
