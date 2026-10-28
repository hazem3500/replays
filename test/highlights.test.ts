import { describe, expect, it } from 'vitest';

import { editTimeline, type ReplayEdits } from '../src/shared/edits.ts';
import { projectHighlights } from '../src/shared/highlights.ts';

const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });

describe('saved highlights', () => {
  it('hides points removed by trim or cuts and keeps visible points on the playback clock', () => {
    const timeline = editTimeline(edits({ trim: { start: 1000, end: 9000 }, cuts: [{ id: 'c', from: 3000, to: 5000 }] }), 10_000);
    expect(
      projectHighlights(
        [
          { id: 'trimmed', kind: 'point', at: 500 },
          { id: 'cut', kind: 'point', at: 4000 },
          { id: 'kept', kind: 'point', at: 6000, label: 'Kept moment' },
        ],
        timeline,
      ),
    ).toEqual([{ id: 'kept', kind: 'point', at: 3000, label: 'Kept moment' }]);
  });

  it('splits a period at cuts and reports only its remaining edited spans', () => {
    const timeline = editTimeline(edits({ trim: { start: 1000, end: 9000 }, cuts: [{ id: 'c', from: 3000, to: 5000 }] }), 10_000);
    expect(projectHighlights([{ id: 'h', kind: 'period', from: 500, to: 9500, label: 'Flow' }], timeline)).toEqual([
      { id: 'h', kind: 'period', from: 0, to: 2000, part: 0, label: 'Flow' },
      { id: 'h', kind: 'period', from: 2000, to: 6000, part: 1, label: 'Flow' },
    ]);
  });

  it('maps period length through speed-ups without claiming trimmed time', () => {
    const timeline = editTimeline(
      edits({
        trim: { start: 1000, end: 9000 },
        speeds: [{ id: 's', from: 5000, to: 7000, rate: 2 }],
      }),
      10_000,
    );
    expect(projectHighlights([{ id: 'h', kind: 'period', from: 4000, to: 8000 }], timeline)).toEqual([
      { id: 'h', kind: 'period', from: 3000, to: 6000, part: 0 },
    ]);
  });
});
