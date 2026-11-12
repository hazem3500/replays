import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { focusSpots } from '../src/client/viewer/focus-marks.ts';
import { groupRepeats, levelCounts, filterRows as filterConsole } from '../src/client/viewer/console/model.ts';
import { withRun } from '../src/server/store/suite-changes.ts';
import type { ReplayBundle, ReplayConsoleEntry } from '../src/shared/replay.ts';
import type { ReviewSuite } from '../src/shared/review-suite.ts';
import { assertFocus, focusSpec, focusTests, parseFocusSpec } from '../src/shared/run-focus.ts';
import { focusArgument } from '../src/suite/cli-io.ts';
import { parsePlan } from '../src/suite/plan.ts';

const tooManyMarkers = Array.from({ length: 21 }, () => ({ panel: 'console', match: 'x' }));

describe('focus specs', () => {
  it('reads the panel, the pattern and the note after " # "', () => {
    expect(parseFocusSpec('network:POST /api/v9/timer # starts the timer')).toEqual({
      panel: 'network',
      match: 'POST /api/v9/timer',
      note: 'starts the timer',
    });
    expect(parseFocusSpec('Console: Uncaught TypeError')).toEqual({ panel: 'console', match: 'Uncaught TypeError' });
  });

  it('keeps a URL fragment in the pattern', () => {
    expect(parseFocusSpec('network:/app#settings').match).toBe('/app#settings');
  });

  it('writes a marker back as the spec it reads', () => {
    const marker = parseFocusSpec('performance:Long task # blocks the click');
    expect(parseFocusSpec(focusSpec(marker))).toEqual(marker);
  });

  it.each([
    ['timer', 'must start with network:'],
    ['storage:key', 'must start with network:'],
    ['network:   ', 'match'],
    [`network:${'x'.repeat(301)}`, 'match'],
  ])('rejects %j', (spec, text) => {
    expect(() => parseFocusSpec(spec)).toThrow(text);
  });

  it('checks stored markers field by field', () => {
    expect(() => assertFocus([{ panel: 'network', match: 'x', extra: 1 }], 'focus')).toThrow('unsupported fields');
    expect(() => assertFocus([{ panel: 'network', match: 'x', note: 'a\nb' }], 'focus')).toThrow('focus[0].note');
    expect(() => assertFocus(tooManyMarkers, 'focus')).toThrow('at most 20');
    expect(() => assertFocus([], 'focus')).not.toThrow();
  });
});

describe('focus tests', () => {
  const tests = focusTests([
    { panel: 'network', match: 'POST /api/v9/*/timer', note: 'starts it' },
    { panel: 'network', match: 'avatars' },
    { panel: 'console', match: 'typeerror' },
    { panel: 'performance', match: "button 'Save'" },
  ]);

  it('matches the method when the pattern names one, and the URL case-insensitively with * as a wildcard', () => {
    expect(tests.network({ method: 'post', url: 'https://x.test/API/v9/workspaces/1/timer' })?.note).toBe('starts it');
    expect(tests.network({ method: 'GET', url: 'https://x.test/api/v9/workspaces/1/timer' })).toBeUndefined();
    expect(tests.network({ method: 'GET', url: 'https://x.test/avatars/1.png' })?.match).toBe('avatars');
  });

  it('treats the rest of the pattern as plain text, not a regular expression', () => {
    const literal = focusTests([{ panel: 'console', match: 'a.b (c)' }]);
    expect(literal.console({ message: 'see a.b (c) here' })).toBeDefined();
    expect(literal.console({ message: 'axb c' })).toBeUndefined();
  });

  it('answers a long non-match of many wildcards at once', () => {
    const wild = focusTests([{ panel: 'console', match: `${'*a'.repeat(20)}*b` }]);
    const started = performance.now();
    expect(wild.console({ message: 'a'.repeat(300) })).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(50);
    expect(wild.console({ message: `${'a'.repeat(20)}b` })).toBeDefined();
  });

  it('says which panels have markers', () => {
    expect(tests.has).toEqual({ network: true, console: true, performance: true });
    expect(focusTests([]).has).toEqual({ network: false, console: false, performance: false });
    expect(tests.performance({ label: "Click button 'Save'" })).toBeDefined();
  });
});

const entry = (at: number, message: string): ReplayConsoleEntry => ({ at, level: 'error', message });

describe('focus in the viewer models', () => {
  const tests = focusTests([
    { panel: 'console', match: 'TypeError', note: 'the bug' },
    { panel: 'network', match: 'GET /timer' },
  ]);

  it('marks console rows and filters to them', () => {
    const rows = groupRepeats([entry(1, 'Uncaught TypeError: x'), entry(2, 'other')], tests);
    expect(rows.map((row) => row.focus?.note)).toEqual(['the bug', undefined]);
    expect(levelCounts(rows).focus).toBe(1);
    expect(filterConsole(rows, 'focus', '').map((row) => row.entry.message)).toEqual(['Uncaught TypeError: x']);
  });

  it('places seek bar marks for marked requests and messages, in time order', () => {
    const request = { id: 'n1', at: 300, duration: 10, method: 'GET', url: 'https://x.test/timer?x=1', status: 200, statusText: 'OK' };
    const bundle: Pick<ReplayBundle, 'console' | 'network'> = {
      console: [entry(900, 'Uncaught TypeError: x')],
      network: [{ ...request, requestHeaders: [], responseHeaders: [] }],
    };
    expect(focusSpots(bundle, tests)).toEqual([
      { at: 300, label: 'GET x.test/timer?x=1' },
      { at: 900, label: 'the bug' },
    ]);
    expect(focusSpots(bundle)).toEqual([]);
  });
});

describe('focus on a stored run', () => {
  const suite: ReviewSuite = { version: 1, id: 's', title: 'S', createdAt: '2026-11-12T10:00:00.000Z', runs: [] };
  const base = { id: 'r', label: 'R', sequence: 1, startedAt: '2026-11-12T10:00:00.000Z', status: 'running' as const };
  const focus = [{ panel: 'network' as const, match: '/timer' }];

  it('keeps the markers when an update leaves them out, and clears them on an empty list', () => {
    const marked = withRun(suite, 'r', { ...base, focus });
    expect(marked.runs[0]?.focus).toEqual(focus);
    const passed = withRun(marked, 'r', { ...base, status: 'passed' });
    expect(passed.runs[0]?.focus).toEqual(focus);
    const cleared = withRun(marked, 'r', { ...base, focus: [] });
    expect(cleared.runs[0]).not.toHaveProperty('focus');
  });
});

describe('focus from the CLI and plans', () => {
  it('reads repeated specs, a file of specs or JSON, and none', async () => {
    expect(await focusArgument([])).toBeUndefined();
    expect(await focusArgument(['none'])).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), 'focus-'));
    const lines = join(dir, 'focus.txt');
    await writeFile(lines, '// what to check\nconsole:TypeError\n\nnetwork:GET /timer # the poll\n');
    const json = join(dir, 'focus.json');
    await writeFile(json, JSON.stringify([{ panel: 'performance', match: 'Long task' }, 'console:Warning']));
    expect(await focusArgument(['network:/x', `@${lines}`, `@${json}`])).toEqual([
      { panel: 'network', match: '/x' },
      { panel: 'console', match: 'TypeError' },
      { panel: 'network', match: 'GET /timer', note: 'the poll' },
      { panel: 'performance', match: 'Long task' },
      { panel: 'console', match: 'Warning' },
    ]);
    await expect(focusArgument(['timer'])).rejects.toThrow('--focus');
    await expect(focusArgument([`@${join(dir, 'missing')}`])).rejects.toThrow('cannot read');
  });

  it('takes markers as objects or specs on a plan run, and names a bad one', () => {
    const run = { id: 'a', title: 'A', url: 'https://example.com/', steps: [] };
    const plan = parsePlan({
      id: 'p',
      title: 'P',
      runs: [{ ...run, focus: ['console:TypeError # the bug', { panel: 'network', match: '/timer' }] }],
    });
    expect(plan.runs[0]?.focus).toEqual([
      { panel: 'console', match: 'TypeError', note: 'the bug' },
      { panel: 'network', match: '/timer' },
    ]);
    expect(() => parsePlan({ id: 'p', title: 'P', runs: [{ ...run, focus: ['nope'] }] })).toThrow('runs[0].focus[0]');
    expect(() => parsePlan({ id: 'p', title: 'P', runs: [{ ...run, focus: 'console:x' }] })).toThrow('runs[0].focus');
  });
});
