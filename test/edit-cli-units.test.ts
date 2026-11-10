import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/edit/args.ts';
import type { EditsApi, EditsRead, SaveResult } from '../src/edit/client.ts';
import { diffEdits } from '../src/edit/describe.ts';
import { EditError } from '../src/edit/errors.ts';
import { CONFLICT_MESSAGE, modifyEdits } from '../src/edit/modify.ts';
import * as ops from '../src/edit/ops.ts';
import { resolveStep, stepRows } from '../src/edit/steps.ts';
import { formatTime, parseTime } from '../src/edit/time.ts';
import { normalizeEdits, type ReplayEdits, type StoredReplayEdits } from '../src/shared/edits.ts';

describe('edit time parsing', () => {
  it.each([
    ['12.3s', 12_300],
    ['0s', 0],
    ['1500ms', 1500],
    ['1:02.5', 62_500],
    ['0:05', 5000],
    ['1:02:03', 3_723_000],
    ['1m30s', 90_000],
    ['2m', 120_000],
    ['start', 0],
    [' 7S ', 7000],
  ])('reads %s as %d ms', (text, ms) => {
    expect(parseTime(text)).toBe(ms);
  });

  it('reads end as the replay length and refuses it without one', () => {
    expect(parseTime('end', 30_000)).toBe(30_000);
    expect(() => parseTime('end')).toThrow('replay length');
  });

  it.each(['12', '12.3', '', 's', '1:75', 'abc', '-3s', '1:2:3:4'])('refuses %j', (text) => {
    expect(() => parseTime(text)).toThrow(/not a time|replay length/);
  });

  it('prints times that it reads back', () => {
    for (const ms of [0, 12_300, 59_900, 62_500, 600_000, 3_723_000]) expect(parseTime(formatTime(ms))).toBe(ms);
    expect(formatTime(10_000)).toBe('10.0s');
    expect(formatTime(62_500)).toBe('1:02.5');
  });
});

const steps = [
  { at: 0, kind: 'open', label: 'Open example.com' },
  { at: 4000, kind: 'click', label: 'Clicked “Save”', auto: true as const },
  { at: 4000, kind: 'type', label: 'Typed' },
  { at: 12_300, kind: 'wait', label: 'Waited' },
  { at: 20_000, kind: 'click', label: 'Clicked “Done”', auto: true as const },
];

describe('step targeting', () => {
  const rows = stepRows(steps, undefined);

  it('numbers steps from 1 and keys renames by start time, with #n for steps in the same ms', () => {
    expect(rows.map((row) => row.key)).toEqual(['0', '4000', '4000#1', '12300', '20000']);
    expect(rows[3]).toMatchObject({ number: 4, time: '12.3s', label: 'Waited' });
  });

  it('resolves 7, #7 and times', () => {
    expect(resolveStep(rows, '4').at).toBe(12_300);
    expect(resolveStep(rows, '#5').at).toBe(20_000);
    expect(resolveStep(rows, '12.3s').number).toBe(4);
    expect(resolveStep(rows, '0:20').number).toBe(5);
    expect(resolveStep(rows, '12400ms').number).toBe(4);
  });

  it('refuses a number out of range, a time that hits nothing and a time that hits several, naming the options', () => {
    expect(() => resolveStep(rows, '9')).toThrow('there is no step 9; this replay has 5');
    expect(() => resolveStep(rows, '9s')).toThrow(/no step starts at 9s; the closest are #4/);
    expect(() => resolveStep(rows, '4s')).toThrow(/2 steps start at 4s; pick one by number: #2.*; #3/);
    expect(() => resolveStep(rows, '7')).toThrow('has 5');
    expect(() => resolveStep(rows, '12')).toThrow('there is no step 12');
  });

  it('shows stored names as labels and marks them renamed', () => {
    const named = stepRows(steps, { '12300': 'Wait for build' });
    expect(named[3]).toMatchObject({ label: 'Wait for build', renamed: true });
  });
});

describe('edit operations', () => {
  const empty: ReplayEdits = { version: 1, cuts: [] };
  const context: ops.EditContext = { duration: 30_000, viewport: { width: 1000, height: 500 }, steps };

  it('reads rects as fractions, percentages and viewport pixels, and refuses bare numbers above 1', () => {
    expect(ops.parseRect('0.1,0.2,0.5,0.25', context.viewport)).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 });
    expect(ops.parseRect('10%,20%,50%,25%', context.viewport)).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 });
    expect(ops.parseRect('100px,100px,500px,125px', context.viewport)).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 });
    expect(() => ops.parseRect('10,20,50,25', context.viewport)).toThrow('above 1');
    expect(() => ops.parseRect('1,2,3', context.viewport)).toThrow('four values');
  });

  it('gives each new item a unique id and removes by id', () => {
    const one = ops.addCut(empty, 1000, 2000);
    const two = ops.addCut(one, 3000, 4000);
    expect(two.cuts.map((cut) => cut.id)).toEqual(['cut-1', 'cut-2']);
    const without = ops.removeItem(two, 'cuts', 'cut-1');
    expect(ops.addCut(without, 5000, 6000).cuts.map((cut) => cut.id)).toEqual(['cut-2', 'cut-3']);
    expect(ops.removeItem(ops.removeItem(two, 'cuts', 'cut-1'), 'cuts', 'cut-2').cuts).toEqual([]);
  });

  it('keeps empty effect lists out of the edit list', () => {
    const withSpeed = ops.addSpeed(empty, 1000, 2000, 4);
    expect(ops.removeItem(withSpeed, 'speeds', 'speed-1')).toEqual(empty);
  });

  it('fits a zoom to a rect and clamps the scale', () => {
    const tight = ops.addZoom(empty, { from: 0, to: 1000, rect: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 } });
    expect(tight.zooms?.[0]).toMatchObject({ scale: 3, x: 0.45, y: 0.45 });
    const wide = ops.addZoom(empty, { from: 0, to: 1000, rect: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    expect(wide.zooms?.[0]?.scale).toBe(2);
    expect(ops.addZoom(empty, { from: 0, to: 1000 }).zooms?.[0]).toEqual({ id: 'zoom-1', from: 0, to: 1000, scale: 1.8 });
  });

  it('adds remove regions as the redact style and blurs without a style', () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(ops.addBlur(empty, 0, 1000, rect, 'redact').blurs?.[0]?.style).toBe('redact');
    expect(ops.addBlur(empty, 0, 1000, rect, 'blur').blurs?.[0]).not.toHaveProperty('style');
  });

  it('cuts only the waits long enough for --min and does not cut one twice', () => {
    const all = ops.addWaitCuts(empty, context, 0);
    expect(all.cuts).toHaveLength(1);
    expect(all.cuts[0]).toMatchObject({ from: 12_700, to: 19_600 });
    expect(() => ops.addWaitCuts(empty, context, 30_000)).toThrow('no wait is long enough');
    expect(() => ops.addWaitCuts(all, context, 0)).toThrow('no wait is long enough');
  });

  it('sets and clears step names, dropping the field when none are left', () => {
    const named = ops.setStepName(empty, '12300', '  Wait for build ');
    expect(named.stepNames).toEqual({ '12300': 'Wait for build' });
    expect(ops.setStepName(named, '12300', '')).toEqual(empty);
  });

  it('summarizes a change by item', () => {
    const before = normalizeEdits(ops.addCut(empty, 1000, 2000));
    const after = normalizeEdits(ops.setStepName(ops.addSpeed(ops.removeItem(before, 'cuts', 'cut-1'), 5000, 9000, 4), '0', 'Start'));
    expect(diffEdits(before, after)).toEqual({
      added: ['speed range 5.0s–9.0s at 4×', 'step name at 0 ms “Start”'],
      removed: ['cut 1.0s–2.0s'],
      changed: [],
    });
  });

  it('numbers items from 1 and keeps to the first-resolved item on a retry', () => {
    const list = normalizeEdits(ops.addCut(ops.addCut(empty, 1000, 2000), 3000, 4000));
    const target = ops.pinnedTarget('cuts', 2);
    expect(target(list)).toBe('cut-2');
    const shifted = normalizeEdits(ops.addCut(list, 100, 300));
    expect(target(shifted)).toBe('cut-2');
    expect(() => target(ops.removeItem(shifted, 'cuts', 'cut-2'))).toThrow('removed by someone else');
    expect(() => ops.pinnedTarget('cuts', 5)(list)).toThrow('there is no cut 5; the replay has 2');
  });
});

describe('arguments', () => {
  const known = { values: ['from', 'to', 'output'], booleans: ['json'] };

  it('reads flags in both forms, positionals and -o', () => {
    expect(parseArgs(['id', 'cut', '--from', '1s', '--to=2s', '-o', 'a.json', '--json'], known)).toEqual({
      positionals: ['id', 'cut'],
      values: { from: '1s', to: '2s', output: 'a.json' },
      booleans: new Set(['json']),
    });
  });

  it('refuses unknown flags and flags without a value', () => {
    expect(() => parseArgs(['--frm', '1s'], known)).toThrow('unknown option --frm');
    expect(() => parseArgs(['--from', '--to', '2s'], known)).toThrow('--from takes a value');
    expect(() => parseArgs(['--from'], known)).toThrow('--from takes a value');
    expect(() => parseArgs(['--json=1'], known)).toThrow('takes no value');
  });
});

const stored = (revision: number, edits: ReplayEdits = { version: 1, cuts: [] }): StoredReplayEdits => ({ ...edits, revision });

/** A server in memory: strict If-Match, the way the edits route answers. */
function fakeApi(initial: StoredReplayEdits) {
  let current = initial;
  let version = initial.revision;
  const puts: ReplayEdits[] = [];
  const hooks: { beforeFirstSave?: (() => void) | undefined } = {};
  const read = (): EditsRead => ({ edits: current, etag: `"e.${version}"` });
  const api: EditsApi = {
    getEdits: async () => read(),
    putEdits: async (edits, etag): Promise<SaveResult> => {
      hooks.beforeFirstSave?.();
      hooks.beforeFirstSave = undefined;
      puts.push(edits);
      if (etag !== `"e.${version}"`) return { status: 'conflict', current: read() };
      version += 1;
      current = { ...edits, revision: current.revision + 1 };
      return { status: 'saved', ...read() };
    },
  };
  const steal = (next: ReplayEdits) => {
    current = { ...next, revision: current.revision + 1 };
    version += 1;
  };
  return { api, puts, hooks, steal };
}

const addCut = (from: number) => (edits: ReplayEdits) => ops.addCut(edits, from, from + 1000);

describe('read-modify-write', () => {
  it('saves a change with the etag it read', async () => {
    const { api, puts } = fakeApi(stored(0));
    const result = await modifyEdits(api, addCut(1000));
    expect(result).toMatchObject({ changed: true, retries: 0, saved: { revision: 1 } });
    expect(puts).toHaveLength(1);
  });

  it('does not write when the change is already there', async () => {
    const { api, puts } = fakeApi(stored(1, { version: 1, cuts: [{ id: 'cut-1', from: 1000, to: 2000 }] }));
    const result = await modifyEdits(api, (edits) => edits);
    expect(result).toMatchObject({ changed: false, retries: 0 });
    expect(puts).toHaveLength(0);
  });

  it('on a 409 applies the change to the list that won and saves once more', async () => {
    const fake = fakeApi(stored(0));
    fake.hooks.beforeFirstSave = () => fake.steal({ version: 1, cuts: [{ id: 'cut-1', from: 9000, to: 9500 }] });
    const result = await modifyEdits(fake.api, addCut(1000));
    expect(result.retries).toBe(1);
    expect(result.saved.cuts.map((cut) => cut.from)).toEqual([1000, 9000]);
    expect(result.saved.revision).toBe(2);
    expect(fake.puts).toHaveLength(2);
  });

  it('gives up with the pull-again message when the retry also conflicts', async () => {
    const api: EditsApi = {
      getEdits: async () => ({ edits: stored(0), etag: '"e.none"' }),
      putEdits: async () => ({ status: 'conflict', current: { edits: stored(1), etag: '"e.1"' } }),
    };
    await expect(modifyEdits(api, addCut(1000))).rejects.toThrow(CONFLICT_MESSAGE);
    await expect(modifyEdits(api, addCut(1000), { retries: 0 })).rejects.toBeInstanceOf(EditError);
  });

  it('lets the change refuse after a conflict, and validates before every save', async () => {
    const fake = fakeApi(stored(0));
    fake.hooks.beforeFirstSave = () => fake.steal({ version: 1, cuts: [] });
    const refuse = (edits: ReplayEdits) => {
      if (fake.puts.length > 0) throw new EditError('gone');
      return ops.addCut(edits, 1000, 2000);
    };
    await expect(modifyEdits(fake.api, refuse)).rejects.toThrow('gone');
    const invalid = fakeApi(stored(0));
    await expect(
      modifyEdits(invalid.api, addCut(1000), {
        validate: () => {
          throw new EditError('nope', 2);
        },
      }),
    ).rejects.toThrow('nope');
    expect(invalid.puts).toHaveLength(0);
  });
});
