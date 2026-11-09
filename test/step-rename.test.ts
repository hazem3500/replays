import { describe, expect, it } from 'vitest';

import { applyEdits, editsVersion, isEmptyEdits, normalizeEdits, renameSteps, stepNameKeys, withStepName } from '../src/shared/edits.ts';
import { assertReplayEdits } from '../src/shared/edit-validation.ts';
import {
  createRenameStore,
  mayRename,
  renameReducer,
  type RenameSession,
  renameResult,
} from '../src/client/viewer/step-rename.ts';
import { replay } from './fixtures.ts';

const session = (draft: string, label = 'Click Save'): RenameSession => ({ key: '1000', surface: 'rail', draft, label, wasPlaying: false });

describe('step names', () => {
  const steps = [
    { at: 0, kind: 'open', label: 'Open' },
    { at: 1000.4, kind: 'click', label: 'Click A' },
    { at: 1000.4, kind: 'click', label: 'Click B' },
  ];

  it('keys steps by whole-ms start, numbering steps that share one', () => {
    expect(stepNameKeys(steps)).toEqual(['0', '1000', '1000#1']);
  });

  it('relabels only named steps and returns the same list when none is named', () => {
    expect(renameSteps(steps, undefined)).toBe(steps);
    expect(renameSteps(steps, { '1000#1': 'Save it' }).map((step) => step.label)).toEqual(['Open', 'Click A', 'Save it']);
  });

  it('trims, caps and removes names', () => {
    expect(withStepName(undefined, '0', '  Hello  ')).toEqual({ '0': 'Hello' });
    expect(withStepName({ '0': 'Hello' }, '0', '   ')).toBeUndefined();
    expect(withStepName({ '0': 'a', '5': 'b' }, '0', '')).toEqual({ '5': 'b' });
    expect(withStepName(undefined, '0', 'x'.repeat(300))?.['0']).toHaveLength(120);
  });

  it('counts as an edit, is kept by normalizing and shows through applyEdits', () => {
    const edits = { version: 1 as const, cuts: [], stepNames: { '0': 'Start here' } };
    expect(isEmptyEdits(edits)).toBe(false);
    expect(normalizeEdits(edits).stepNames).toEqual({ '0': 'Start here' });
    expect(editsVersion(edits)).not.toBe(editsVersion({ version: 1, cuts: [], stepNames: { '0': 'Other' } }));
    expect(applyEdits(replay(), edits).bundle.steps[0]?.label).toBe('Start here');
  });

  it('validates keys and text', () => {
    expect(() => assertReplayEdits({ version: 1, cuts: [], stepNames: { '12': 'ok', '12#1': 'ok' } })).not.toThrow();
    expect(() => assertReplayEdits({ version: 1, cuts: [], stepNames: { abc: 'x' } })).toThrow(/not a step key/);
    expect(() => assertReplayEdits({ version: 1, cuts: [], stepNames: { '1': '' } })).toThrow();
  });
});

describe('rename session', () => {
  it('starts with the current label, edits the draft and ends', () => {
    const started = renameReducer(undefined, { type: 'start', key: '1000', surface: 'rail', label: 'Click Save' });
    expect(started).toMatchObject({ draft: 'Click Save', label: 'Click Save', wasPlaying: false });
    expect(renameReducer(started, { type: 'change', draft: 'Save it' })?.draft).toBe('Save it');
    expect(renameReducer(started, { type: 'end' })).toBeUndefined();
    expect(renameReducer(undefined, { type: 'change', draft: 'x' })).toBeUndefined();
  });

  it('keeps the draft when the same step is started again and caps it', () => {
    const edited = renameReducer(
      renameReducer(undefined, { type: 'start', key: '1', surface: 'caption', label: 'A', wasPlaying: true }),
      { type: 'change', draft: 'B'.repeat(200) },
    );
    expect(edited?.draft).toHaveLength(120);
    expect(renameReducer(edited, { type: 'start', key: '1', surface: 'caption', label: 'A' })).toBe(edited);
  });

  it('saves a trimmed name, nothing when unchanged, and an empty string for reset or a cleared field', () => {
    expect(renameResult(session('  Save it '))).toBe('Save it');
    expect(renameResult(session('Click Save'))).toBeUndefined();
    expect(renameResult(session('   '))).toBe('');
    expect(renameResult(session('Anything'), true)).toBe('');
  });

  it('notifies subscribers only when the session changes', () => {
    const store = createRenameStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: 'start', key: '1', surface: 'rail', label: 'A' });
    store.dispatch({ type: 'start', key: '1', surface: 'rail', label: 'A' });
    store.dispatch({ type: 'end' });
    expect(calls).toBe(2);
    expect(store.get()).toBeUndefined();
  });
});

describe('mayRename', () => {
  const people = [{ role: 'reporter', email: 'ada@example.com' }];
  it('allows a matching email or an admin and nobody else', () => {
    expect(mayRename({ email: 'Ada@Example.com' }, people)).toBe(true);
    expect(mayRename({ email: 'bob@example.com', roles: ['admin'] }, people)).toBe(true);
    expect(mayRename({ email: 'bob@example.com' }, people)).toBe(false);
    expect(mayRename(undefined, people)).toBe(false);
    expect(mayRename({ email: 'ada@example.com' }, undefined)).toBe(false);
  });
});
