import { describe, expect, it } from 'vitest';

import { normalizeSteps } from '../src/shared/step-names.ts';

type Row = readonly [at: number, kind: string, label: string];
const shown = (list: ReadonlyArray<{ folded?: true; label: string }>) => list.filter((step) => !step.folded).map((step) => step.label);
const steps = (rows: readonly Row[]): Array<{ at: number; kind: string; label: string; folded?: true }> =>
  rows.map(([at, kind, label]) => ({ at, kind, label }));

const RECORDED = steps([
  [0, 'start', 'Recording started'],
  [1200, 'click', 'Clicked “Plan time • 4h”'],
  [1200, 'submit', 'Submitted form'],
  [3000, 'click', 'Clicked “Projects”'],
  [3000, 'navigate', 'Navigated to another page'],
  [5000, 'click', 'Clicked “Tasks”'],
  [5100, 'navigate', 'Navigated to another page'],
  [7000, 'click', 'Clicked “Create a new task”'],
  [8000, 'click', 'Clicked “Add to project”'],
  [9000, 'click', 'Clicked button'],
  [10000, 'click', 'Clicked “Create task”'],
  [10000, 'submit', 'Submitted form'],
  [12000, 'click', 'Clicked “Profile:”'],
  [13000, 'click', 'Clicked “Settings”'],
  [14000, 'click', 'Clicked field'],
  [15000, 'click', 'Clicked “Clear”'],
  [16000, 'click', 'Clicked “Close”'],
  [20000, 'stop', 'Recording stopped'],
]);

const CASES = [
  ['trims a trailing colon', [[0, 'click', 'Clicked “Profile:”']], ['Clicked “Profile”']],
  ['collapses whitespace', [[0, 'click', 'Clicked “Plan   time ”']], ['Clicked “Plan time”']],
  ['reads straight quotes', [[0, 'click', 'Clicked "Tasks"']], ['Clicked “Tasks”']],
  [
    'folds a navigation within a second',
    [
      [0, 'click', 'Clicked “Tasks”'],
      [1000, 'navigate', 'Navigated'],
    ],
    ['Opened “Tasks”'],
  ],
  [
    'keeps a navigation after a second',
    [
      [0, 'click', 'Clicked “Tasks”'],
      [1001, 'navigate', 'Navigated'],
    ],
    ['Clicked “Tasks”', 'Navigated'],
  ],
  [
    'drops the navigation after an unnamed click',
    [
      [0, 'click', 'Clicked link'],
      [10, 'navigate', 'Navigated'],
    ],
    ['Clicked link'],
  ],
  [
    'drops a form submission after its click',
    [
      [0, 'click', 'Clicked “Save”'],
      [0, 'submit', 'Requested “Save”'],
    ],
    ['Clicked “Save”'],
  ],
  ['keeps a form submission without a click', [[0, 'submit', 'Submitted form']], ['Submitted form']],
  [
    'keeps the navigation that follows a submission',
    [
      [0, 'click', 'Clicked “Save”'],
      [0, 'submit', 'Submitted form'],
      [100, 'navigate', 'Navigated'],
    ],
    ['Clicked “Save”', 'Navigated'],
  ],
  [
    'folds only the first navigation',
    [
      [0, 'click', 'Clicked “A”'],
      [10, 'navigate', 'Navigated'],
      [20, 'navigate', 'Navigated'],
    ],
    ['Opened “A”', 'Navigated'],
  ],
  [
    'keeps a click that does not match',
    [
      [0, 'click', 'Clicked “A”'],
      [10, 'action', 'Checked A'],
      [20, 'navigate', 'Navigated'],
    ],
    ['Clicked “A”', 'Checked A', 'Navigated'],
  ],
] as const;

describe('normalizeSteps', () => {
  it('turns a recorded Toggl Focus session into compact steps, keeping their times', () => {
    expect(
      normalizeSteps(RECORDED)
        .filter((step) => !step.folded)
        .map(({ at, label }) => [at, label]),
    ).toEqual([
      [0, 'Recording started'],
      [1200, 'Clicked “Plan time • 4h”'],
      [3000, 'Opened “Projects”'],
      [5000, 'Opened “Tasks”'],
      [7000, 'Clicked “Create a new task”'],
      [8000, 'Clicked “Add to project”'],
      [9000, 'Clicked button'],
      [10000, 'Clicked “Create task”'],
      [12000, 'Clicked “Profile”'],
      [13000, 'Clicked “Settings”'],
      [14000, 'Clicked field'],
      [15000, 'Clicked “Clear”'],
      [16000, 'Clicked “Close”'],
      [20000, 'Recording stopped'],
    ]);
  });

  it.each(CASES)('%s', (_name, rows, expected) => {
    expect(shown(normalizeSteps(steps(rows)))).toEqual(expected);
  });

  it('keeps every step at its index and time, marking the absorbed ones folded', () => {
    const out = normalizeSteps(RECORDED);
    expect(out.map((step) => step.at)).toEqual(RECORDED.map((step) => step.at));
    expect(out.map((step) => step.kind)).toEqual(RECORDED.map((step) => step.kind));
    expect(out.flatMap((step, index) => (step.folded ? [index] : []))).toEqual([2, 4, 6, 11]);
    expect(out[3]?.label).toBe('Opened “Projects”');
  });
});

describe('normalizeSteps and manual labels', () => {
  it('leaves steps a person labelled, or the capture CLI labelled, as they are', () => {
    const manual = [
      { at: 0, kind: 'click', label: 'Clicked “Profile:”', auto: false },
      { at: 1, kind: 'navigate', label: 'Navigated', auto: false },
      { at: 2, kind: 'action', label: 'Clicked “Settings:”' },
      { at: 3, kind: 'click', label: 'Open the settings page' },
      { at: 4, kind: 'click', label: 'Click “Save:”' },
    ];
    expect(normalizeSteps(manual)).toEqual(manual);
  });

  it('rewrites generated steps marked auto and is idempotent', () => {
    const generated = [{ at: 0, kind: 'click', label: 'Clicked “Profile:”', auto: true as const }];
    const once = normalizeSteps(generated);
    expect(once).toEqual([{ at: 0, kind: 'click', label: 'Clicked “Profile”', auto: true }]);
    expect(normalizeSteps(once)).toEqual(once);
    expect(normalizeSteps(normalizeSteps(RECORDED))).toEqual(normalizeSteps(RECORDED));
  });

  it('does not change its input', () => {
    const input = steps([[0, 'click', 'Clicked “Profile:”']]);
    normalizeSteps(input);
    expect(input[0]?.label).toBe('Clicked “Profile:”');
  });
});
