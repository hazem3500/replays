import { describe, expect, it } from 'vitest';
import { must } from './must.ts';

import {
  addCut,
  addPointHighlight,
  addPeriodHighlight,
  cutRange,
  editorReducer,
  editorShortcutFor,
  initialEditorState,
  isDirty,
  leavesSomething,
  moveCut,
  parseClock,
  removeWaits,
  removeHighlight,
  updateHighlight,
  savedAgo,
  setTrimEdge,
  waitSuggestions,
} from '../src/client/editor/state.ts';
import type { ReplayEdits } from '../src/shared/edits.ts';

const empty: ReplayEdits = { version: 1, cuts: [] };
const key = (name: string, extra: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: name,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...extra,
});

describe('editor state', () => {
  it('adds, edits, deletes, undoes and redoes point and period highlights', () => {
    const point = addPointHighlight(empty, 1250, 10_000);
    expect(addPointHighlight(point.edits, 1250, 10_000)).toEqual({ edits: point.edits, id: point.id });
    const period = must(addPeriodHighlight(point.edits, 2000, 5000, 10_000));
    expect(period.edits.highlights).toHaveLength(2);
    let state = editorReducer(initialEditorState(empty), {
      type: 'change',
      edits: period.edits,
      select: { kind: 'highlight', id: period.id },
    });
    state = editorReducer(state, {
      type: 'change',
      edits: updateHighlight(state.present, period.id, { kind: 'period', from: 2200, label: 'Checkout' }, 10_000),
      select: { kind: 'highlight', id: period.id },
    });
    expect(state.present.highlights?.find((item) => item.id === period.id)).toMatchObject({ from: 2200, to: 5000, label: 'Checkout' });
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.highlights?.find((item) => item.id === period.id)).toMatchObject({ from: 2000, to: 5000 });
    state = editorReducer(state, { type: 'redo' });
    state = editorReducer(state, { type: 'change', edits: removeHighlight(state.present, point.id) });
    expect(state.present.highlights?.map((item) => item.id)).toEqual([period.id]);
    expect(addPeriodHighlight(empty, 100, 199, 10_000)).toBeUndefined();
    expect(editorShortcutFor(key('m'))).toBe('highlight');
  });

  it('undoes and redoes changes, and a drag is one step', () => {
    let state = initialEditorState(empty);
    const first = addCut(empty, 1000, 10_000)!;
    state = editorReducer(state, { type: 'change', edits: first.edits, select: { kind: 'cut', id: first.id } });
    expect(state.selection).toEqual({ kind: 'cut', id: 'cut-1' });
    // A drag: the first move is a step, the rest merge into it.
    state = editorReducer(state, { type: 'change', edits: moveCut(state.present, 'cut-1', 'to', 2500, 10_000) });
    state = editorReducer(state, { type: 'change', edits: moveCut(state.present, 'cut-1', 'to', 3000, 10_000), merge: true });
    expect(state.past).toHaveLength(2);
    expect(isDirty(state)).toBe(true);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.cuts[0]).toMatchObject({ from: 1000, to: 2000 });
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.cuts).toEqual([]);
    expect(state.selection).toBeUndefined();
    expect(isDirty(state)).toBe(false);
    state = editorReducer(state, { type: 'redo' });
    state = editorReducer(state, { type: 'redo' });
    expect(state.present.cuts[0]).toMatchObject({ to: 3000 });
    state = editorReducer(state, { type: 'saved', edits: state.present });
    expect(isDirty(state)).toBe(false);
    // A new change clears the redo stack.
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'change', edits: setTrimEdge(state.present, 'start', 500, 10_000) });
    expect(state.future).toEqual([]);
  });

});

describe('editor state trims, cuts and keys', () => {
  it('keeps the trim sane', () => {
    expect(setTrimEdge(empty, 'start', 2000, 10_000).trim).toEqual({ start: 2000, end: 10_000 });
    expect(setTrimEdge({ ...empty, trim: { start: 2000, end: 3000 } }, 'end', 1000, 10_000).trim).toEqual({ start: 2000, end: 2100 });
    // Back to the whole replay: no trim at all.
    expect(setTrimEdge({ ...empty, trim: { start: 2000, end: 10_000 } }, 'start', -50, 10_000).trim).toBeUndefined();
  });

  it('places new cuts inside the trim and refuses when there is no room', () => {
    const trimmed = { ...empty, trim: { start: 1000, end: 5000 } };
    expect(addCut(trimmed, 4800, 10_000)!.edits.cuts[0]).toMatchObject({ from: 4000, to: 5000 });
    expect(addCut({ ...empty, trim: { start: 1000, end: 1150 } }, 1000, 10_000)).toBeUndefined();
  });

  it('cuts a dragged range inside the trim, either way round', () => {
    const trimmed = { ...empty, trim: { start: 1000, end: 5000 } };
    expect(cutRange(trimmed, 4500, 500, 10_000)!.edits.cuts[0]).toEqual({ id: 'cut-1', from: 1000, to: 4500 });
    expect(cutRange(trimmed, 5000, 6000, 10_000)).toBeUndefined();
  });

  it('removes waits with fresh ids and knows when nothing would be left', () => {
    const steps = [
      { at: 0, kind: 'open', label: 'Open' },
      { at: 1000, kind: 'wait', label: 'Wait' },
      { at: 5000, kind: 'click', label: 'Click' },
    ];
    const once = removeWaits(empty, steps, 6000);
    expect(once.added).toBe(1);
    expect(once.edits.cuts[0]).toMatchObject({ id: 'wait-2', from: 1400, to: 4600 });
    expect(removeWaits(once.edits, steps, 6000).added).toBe(0);
    // Suggestions are the same cuts, not yet applied.
    expect(waitSuggestions(empty, steps, 6000)).toEqual(once.edits.cuts);
    expect(waitSuggestions(once.edits, steps, 6000)).toEqual([]);
    expect(leavesSomething({ ...empty, cuts: [{ id: 'a', from: 0, to: 6000 }] }, 6000)).toBe(false);
  });

  it('maps keys, leaving typing alone', () => {
    expect(editorShortcutFor(key('z', { metaKey: true }))).toBe('undo');
    expect(editorShortcutFor(key('z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(editorShortcutFor(key('y', { ctrlKey: true }), null, false)).toBe('redo');
    expect(editorShortcutFor(key('s', { ctrlKey: true }), null, false)).toBe('save');
    expect(editorShortcutFor(key('i'))).toBe('trim-start');
    expect(editorShortcutFor(key('c'))).toBe('add-cut');
    expect(editorShortcutFor(key('s'))).toBe('add-cut');
    expect(editorShortcutFor(key('ArrowRight'))).toBe('nudge-forward');
    expect(editorShortcutFor(key('ArrowLeft', { shiftKey: true }))).toBe('seek-back');
    expect(editorShortcutFor(key('Enter'))).toBe('apply');
    expect(editorShortcutFor(key('Escape'))).toBe('deselect');
    expect(editorShortcutFor(key('Backspace'))).toBe('delete');
    expect(editorShortcutFor(key('c'), { tagName: 'INPUT', type: 'text' })).toBeUndefined();
    expect(editorShortcutFor(key(' '), { tagName: 'BUTTON' })).toBeUndefined();
  });

  it('parses typed times and says when something was saved', () => {
    expect(parseClock('1:02.5')).toBe(62_500);
    expect(parseClock('3.25')).toBe(3250);
    expect(parseClock('1:75')).toBeUndefined();
    expect(parseClock('soon')).toBeUndefined();
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(savedAgo('2026-10-14T11:57:00Z', now)).toBe('3 min ago');
    expect(savedAgo('2026-10-13T11:00:00Z', now)).toBe('yesterday');
    expect(savedAgo(undefined, now)).toBe('');
  });
});
