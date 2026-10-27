import { describe, expect, it } from 'vitest';

import { assertReplayEdits, assertStoredReplayEdits, MAX_CUTS, MAX_LABEL, MIN_EDIT_MS } from '../src/shared/edits.ts';
import { MAX_CAPTION, MAX_EFFECTS, MAX_ZOOM_SCALE, MIN_ZOOM_SCALE } from '../src/shared/effects.ts';

const edit = (from = 0, to = MIN_EDIT_MS) => ({ version: 1, cuts: [{ id: 'cut', from, to }] });

describe('edit limit boundaries', () => {
  it('accepts MAX_CUTS and rejects one more', () => {
    const cuts = Array.from({ length: MAX_CUTS }, (_, i) => ({ id: `c-${i}`, from: i * 200, to: i * 200 + MIN_EDIT_MS }));
    expect(() => assertReplayEdits({ version: 1, cuts })).not.toThrow();
    expect(() => assertReplayEdits({ version: 1, cuts: [...cuts, { id: 'extra', from: 0, to: MIN_EDIT_MS }] })).toThrow('cuts');
  });

  it('accepts MAX_LABEL and rejects one more character', () => {
    expect(() => assertReplayEdits({ ...edit(), cuts: [{ ...edit().cuts[0], label: 'x'.repeat(MAX_LABEL) }] })).not.toThrow();
    expect(() => assertReplayEdits({ ...edit(), cuts: [{ ...edit().cuts[0], label: 'x'.repeat(MAX_LABEL + 1) }] })).toThrow('label');
  });

  it('enforces minimum cut and trim lengths and the final remaining duration', () => {
    expect(() => assertReplayEdits(edit())).not.toThrow();
    expect(() => assertReplayEdits(edit(0, MIN_EDIT_MS - 1))).toThrow('at least');
    expect(() => assertReplayEdits({ version: 1, cuts: [], trim: { start: 0, end: MIN_EDIT_MS } }, 1000)).not.toThrow();
    expect(() => assertReplayEdits({ version: 1, cuts: [], trim: { start: 0, end: MIN_EDIT_MS - 1 } }, 1000)).toThrow('at least');
    expect(() => assertReplayEdits(edit(0, 1000 - MIN_EDIT_MS), 1000)).not.toThrow();
    expect(() => assertReplayEdits(edit(0, 1001 - MIN_EDIT_MS), 1000)).toThrow('whole replay');
  });

  it.each([NaN, Infinity, -1])('rejects invalid edit times %s', (time) => {
    expect(() => assertReplayEdits(edit(time, 1000))).toThrow('time');
  });

  it('enforces effect counts, caption length and zoom scale edges', () => {
    const captions = Array.from({ length: MAX_EFFECTS }, (_, i) => ({
      id: `caption-${i}`,
      from: 0,
      to: MIN_EDIT_MS,
      text: 'x'.repeat(MAX_CAPTION),
    }));
    expect(() => assertReplayEdits({ version: 1, cuts: [], captions })).not.toThrow();
    expect(() => assertReplayEdits({ version: 1, cuts: [], captions: [...captions, { ...captions[0], id: 'extra' }] })).toThrow('at most');
    expect(() => assertReplayEdits({ version: 1, cuts: [], captions: [{ ...captions[0], text: 'x'.repeat(MAX_CAPTION + 1) }] })).toThrow(
      'text',
    );
    for (const scale of [MIN_ZOOM_SCALE, MAX_ZOOM_SCALE])
      expect(() => assertReplayEdits({ version: 1, cuts: [], zooms: [{ id: 'zoom', from: 0, to: MIN_EDIT_MS, scale }] })).not.toThrow();
    for (const scale of [MIN_ZOOM_SCALE - 0.01, MAX_ZOOM_SCALE + 0.01])
      expect(() => assertReplayEdits({ version: 1, cuts: [], zooms: [{ id: 'zoom', from: 0, to: MIN_EDIT_MS, scale }] })).toThrow('scale');
  });

  it('validates stored revisions, authorship and timestamps', () => {
    expect(() => assertStoredReplayEdits({ ...edit(), revision: 0 })).not.toThrow();
    for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => assertStoredReplayEdits({ ...edit(), revision })).toThrow('revision');
    expect(() => assertStoredReplayEdits({ ...edit(), revision: 1, updatedBy: 'x'.repeat(255) })).toThrow('updatedBy');
    expect(() => assertStoredReplayEdits({ ...edit(), revision: 1, updatedAt: 'invalid' })).toThrow('updatedAt');
  });
});
