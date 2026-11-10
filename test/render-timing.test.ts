import { describe, expect, it } from 'vitest';

import { describeRender } from '../src/server/renderer.ts';

describe('describeRender', () => {
  it('reports the job size and where the wall time went', () => {
    expect(
      describeRender({ id: 'r1', frames: 300, captured: 120, durationMs: 20_000, replayMs: 10_000, seekMs: 4_000, captureMs: 12_000 }),
    ).toBe('render r1: 300 frames (120 captured) for 10.0 s of replay in 20.0 s (seek 4.0 s, capture 12.0 s, other 4.0 s)');
  });

  it('never reports negative remaining time', () => {
    expect(describeRender({ id: 'r2', frames: 1, captured: 1, durationMs: 1_000, replayMs: 500, seekMs: 700, captureMs: 600 })).toContain(
      'other 0.0 s',
    );
  });
});
