// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { assertReplayEdits, applyEdits, editsVersion, isEmptyEdits, normalizeEdits, type ReplayEdits } from '../src/shared/edits.ts';
import { IDENTITY_TIME, playbackEffects } from '../src/shared/effects.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { buildCursorTrack, cursorInput, cursorPose } from '../src/client/cursor-motion.ts';
import { ReplayCursor } from '../src/client/replay-cursor.ts';
import { editorReducer, initialEditorState, isDirty } from '../src/client/editor/state.ts';

const events = [
  { type: 4, timestamp: 1000, data: { width: 800, height: 600 } },
  { type: 3, timestamp: 1100, data: { source: 1, positions: [{ x: 100, y: 100, timeOffset: 0 }] } },
  { type: 3, timestamp: 1700, data: { source: 2, type: 2, x: 100, y: 100 } },
  { type: 5, timestamp: 6000, data: { tag: 'end' } },
];
const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });
const bundle = { events, meta: { duration: 5000 }, steps: [], console: [], network: [] } as unknown as ReplayBundle;

describe('saved cursor settings', () => {
  it('keeps old edit defaults and cache versions unchanged', () => {
    const defaults = edits({ cursor: { visible: true, size: 1, hideWhenIdle: true, clickFeedback: true, motion: 'signature_arc', appearance: 'arrow' } });
    expect(normalizeEdits(defaults)).toEqual(edits());
    expect(isEmptyEdits(defaults)).toBe(true);
    expect(editsVersion(defaults)).toBe('');
    for (const cursor of [
      { visible: false },
      { size: 1.5 },
      { hideWhenIdle: false },
      { clickFeedback: false },
      { motion: 'classic' as const },
      { appearance: 'ring' as const },
      { color: 'green' as const },
    ]) {
      const next = edits({ cursor });
      expect(() => assertReplayEdits(next)).not.toThrow();
      expect(isEmptyEdits(next)).toBe(false);
      expect(editsVersion(next)).not.toBe('');
    }
  });

  it('rejects unsupported controls and invalid values', () => {
    for (const cursor of [
      { size: 0 },
      { size: 3 },
      { size: Number.NaN },
      { visible: 'yes' },
      { hideWhenIdle: null },
      { preset: 'invented' },
      { motion: 'bouncy' },
      { motion: 1 },
      { appearance: 'blob' },
      { color: 'red' },
    ]) {
      expect(() => assertReplayEdits({ ...edits(), cursor })).toThrow('edits.cursor');
    }
  });

  it('carries settings through preview and export, including edited time', () => {
    const cursor = { size: 1.5, hideWhenIdle: false, clickFeedback: false };
    const list = edits({ cursor });
    expect(playbackEffects(list, IDENTITY_TIME(5000), events).cursor).toEqual(cursor);
    expect(applyEdits(bundle, list).effects.cursor).toEqual(cursor);
    expect(applyEdits(bundle, edits({ cursor, cuts: [{ id: 'cut', from: 1000, to: 2000 }] })).effects.cursor).toEqual(cursor);
    expect(editsVersion(list)).not.toBe(editsVersion(edits({ cursor: { ...cursor, size: 2 } })));
  });

  it('uses the editor undo, redo and saved-state semantics', () => {
    const initial = initialEditorState(edits());
    const changed = editorReducer(initial, { type: 'change', edits: edits({ cursor: { visible: false } }) });
    expect(isDirty(changed)).toBe(true);
    const undone = editorReducer(changed, { type: 'undo' });
    expect(isDirty(undone)).toBe(false);
    expect(editorReducer(undone, { type: 'redo' }).present.cursor).toEqual({ visible: false });
    expect(isDirty(editorReducer(changed, { type: 'saved', edits: changed.present }))).toBe(false);
  });
});

describe('cursor presentation in the shared renderer', () => {
  it('can keep an idle cursor visible and disable click squish independently', () => {
    const input = cursorInput(events);
    const original = buildCursorTrack(input);
    const steady = buildCursorTrack(input, { settings: { hideWhenIdle: false, clickFeedback: false } });
    expect(cursorPose(original, 5900).opacity).toBe(0);
    expect(cursorPose(steady, 5900).opacity).toBe(1);
    expect(cursorPose(original, 1760).scale).toBeLessThan(1);
    expect(cursorPose(steady, 1760).scale).toBe(1);
    expect(cursorPose(buildCursorTrack(input, { settings: { visible: false } }), 1760).visible).toBe(false);
    const reduced = buildCursorTrack(input, { reducedMotion: true, settings: { hideWhenIdle: false } });
    expect(cursorPose(reduced, 1760).scale).toBe(1);
  });

  it('updates a mounted paused preview immediately and restores defaults', () => {
    const host = document.createElement('div');
    const cursor = new ReplayCursor(host, events, 1000);
    try {
      cursor.update(760);
      const element = host.querySelector<HTMLElement>('.replay-cursor')!;
      cursor.setSettings({ size: 2, hideWhenIdle: false, clickFeedback: false });
      expect(element.style.transform).toContain('scale(2.0000)');
      cursor.setSettings({ visible: false });
      expect(element.hidden).toBe(true);
      cursor.setSettings(undefined);
      expect(element.hidden).toBe(false);
      cursor.update(4900);
      expect(Number(element.style.opacity)).toBe(0);
      cursor.setSettings({ hideWhenIdle: false });
      expect(element.style.opacity).toBe('');
    } finally {
      cursor.destroy();
    }
    expect(host.children.length).toBe(0);
  });
});
