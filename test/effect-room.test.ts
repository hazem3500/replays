import { describe, expect, it } from 'vitest';
import { must } from './must.ts';

import { addEffect, effectList, moveEffect, noRoomFor } from '../src/client/editor/state.ts';
import { duplicateEffect, splitEffect } from '../src/client/editor/phone-edits.ts';
import { normalizeEdits, type ReplayEdits } from '../src/shared/edits.ts';
import { proposeStepCaptions } from '../src/shared/effects.ts';

const DURATION = 10_000;
const captions = (...spans: Array<[number, number]>): ReplayEdits => ({
  version: 1,
  cuts: [],
  captions: spans.map(([from, to], index) => ({ id: `caption-${index + 1}`, from, to, text: `Caption ${index + 1}` })),
});
const spans = (edits: ReplayEdits) => effectList(edits, 'caption').map(({ from, to }) => [from, to]);

describe('captions never overlap', () => {
  it('stops a dragged end edge at the next caption’s start', () => {
    const moved = moveEffect(captions([1000, 2000], [3000, 4000]), 'caption', 'caption-1', 'to', 3600, DURATION);
    expect(spans(moved)).toEqual([
      [1000, 3000],
      [3000, 4000],
    ]);
  });

  it('stops a dragged start edge at the previous caption’s end', () => {
    const moved = moveEffect(captions([1000, 2000], [3000, 4000]), 'caption', 'caption-2', 'from', 1200, DURATION);
    expect(spans(moved)).toEqual([
      [1000, 2000],
      [2000, 4000],
    ]);
  });

  it('stops a moved caption against its neighbour without changing its length', () => {
    const moved = moveEffect(captions([1000, 2000], [3000, 4000]), 'caption', 'caption-1', 'move', 2500, DURATION);
    expect(spans(moved)).toEqual([
      [2000, 3000],
      [3000, 4000],
    ]);
  });

  it('keeps a typed end time from reaching past the next caption', () => {
    const typed = moveEffect(captions([1000, 2000], [3000, 4000]), 'caption', 'caption-1', 'to', 9000, DURATION);
    expect(spans(typed)[0]).toEqual([1000, 3000]);
  });

  it('keeps a caption at least the minimum length when its start is typed past its end', () => {
    const typed = moveEffect(captions([1000, 2000]), 'caption', 'caption-1', 'from', 5000, DURATION);
    expect(spans(typed)[0]).toEqual([1900, 2000]);
  });

  it('ends a caption added at the playhead where the next one starts', () => {
    const added = addEffect(captions([4000, 6000]), 'caption', 2500, 5500, DURATION);
    expect(spans(must(added).edits)).toEqual([
      [4000, 6000],
      [2500, 4000],
    ]);
  });

  it('adds no caption at a playhead inside another caption, and names why', () => {
    expect(addEffect(captions([4000, 6000]), 'caption', 5000, 8000, DURATION)).toBeUndefined();
    expect(noRoomFor('caption')).toMatch(/caption already shows here/);
  });

  it('adds no caption into a gap shorter than the minimum length', () => {
    expect(addEffect(captions([1000, 2000], [2050, 4000]), 'caption', 2000, 5000, DURATION)).toBeUndefined();
  });

  it('proposes step captions that take turns even when steps share a time', () => {
    const proposed = proposeStepCaptions(
      [
        { at: 1000, label: 'Open' },
        { at: 1000, label: 'Click' },
        { at: 1500, label: 'Type' },
      ],
      DURATION,
    );
    for (const [index, caption] of proposed.entries()) expect(caption.from).toBeGreaterThanOrEqual(proposed[index - 1]?.to ?? 0);
  });

  it('keeps a split or duplicated caption out of its neighbour', () => {
    const edits = captions([1000, 3000], [4000, 5000]);
    const duplicated = must(duplicateEffect(edits, 'caption', 'caption-1', DURATION));
    expect(spans(duplicated.edits).at(-1)).toEqual([3000, 4000]);
    const split = must(splitEffect(edits, { kind: 'caption', id: 'caption-1', time: 2000, duration: DURATION }));
    expect(spans(normalizeEdits(split.edits))).toEqual([
      [1000, 2000],
      [2000, 3000],
      [4000, 5000],
    ]);
  });

  it('separates overlapping captions saved before the rule by ending the earlier one where the later starts', () => {
    expect(spans(normalizeEdits(captions([1000, 3000], [2000, 4000])))).toEqual([
      [1000, 2000],
      [2000, 4000],
    ]);
  });

  it('starts a saved caption after one that began at nearly the same time, and drops one with nothing left after it', () => {
    expect(spans(normalizeEdits(captions([1000, 3000], [1050, 4000])))).toEqual([
      [1000, 3000],
      [3000, 4000],
    ]);
    expect(spans(normalizeEdits(captions([1000, 3000], [1020, 3050])))).toEqual([[1000, 3000]]);
  });
});

describe('zooms take turns like captions', () => {
  it('ends a new zoom where the next zoom starts', () => {
    const first = must(addEffect({ version: 1, cuts: [] }, 'zoom', 5000, 7000, DURATION));
    const second = must(addEffect(first.edits, 'zoom', 3000, 6000, DURATION));
    expect(effectList(second.edits, 'zoom').map(({ from, to }) => [from, to])).toEqual([
      [5000, 7000],
      [3000, 5000],
    ]);
  });

  it('lets a blur box overlap another, since boxes can cover different areas at once', () => {
    const first = must(addEffect({ version: 1, cuts: [] }, 'blur', 1000, 4000, DURATION));
    const second = must(addEffect(first.edits, 'blur', 2000, 5000, DURATION));
    expect(effectList(second.edits, 'blur').map(({ from, to }) => [from, to])).toEqual([
      [1000, 4000],
      [2000, 5000],
    ]);
  });
});
